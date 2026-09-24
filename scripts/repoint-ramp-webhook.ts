/**
 * Re-point the registered Ramp webhook at a new origin (e.g. an ngrok tunnel so
 * Ramp's sandbox can reach a local dev server).
 *
 * Ramp's API has no "update webhook" endpoint — the client exposes only
 * create/delete — so this registers a new one and removes the old.
 *
 * Why not just call `ensureRampWebhook` with the new origin: it returns early
 * when `metadata.webhookId` is set, and even after clearing that its create
 * carries a DETERMINISTIC idempotency key (`sha256(companyId:createWebhook:
 * companyId)` — the URL is not in it) which Ramp replays for 24h. You would get
 * the OLD webhook back, at the old URL, and this script would look like it
 * succeeded. The create below scopes the key to the new endpoint instead.
 *
 * Order is create → persist → delete-old, deliberately. The reverse can leave a
 * stored `webhookId` pointing at a webhook that no longer exists, and because
 * `ensureRampWebhook` skips whenever that field is set, the integration would
 * then never re-register and every delivery would fail silently. Creating first
 * means the worst case is two live registrations — the stale one points at an
 * unreachable host and can be removed on a re-run.
 *
 * Usage:
 *   pnpm exec tsx scripts/repoint-ramp-webhook.ts <companyId> <origin>
 */

// Deep subpath, NOT the `@carbon/auth` barrel: the barrel transitively pulls
// `@carbon/react`, whose `LabelWithHelp` value-imports `@carbon/glossary`, whose
// `msg` Lingui macro throws under plain tsx ("msg is not a function"). This
// module is server-only and macro-free.
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildRampIdempotencyKey,
  getRampIntegration,
  patchRampWebhook,
  RAMP_WEBHOOK_EVENT_TYPES
} from "@carbon/ee/ramp.server";
import { z } from "zod";

/** Mirrors the (module-private) schema `ensureRampWebhook` parses with. */
const WebhookCreateResponse = z
  .object({ id: z.string(), secret: z.string().optional() })
  .passthrough();

const [companyId, rawOrigin] = process.argv.slice(2);

if (!companyId || !rawOrigin) {
  console.error(
    "Usage: tsx scripts/repoint-ramp-webhook.ts <companyId> <origin>"
  );
  process.exit(1);
}
if (!rawOrigin.startsWith("https://")) {
  console.error(`Origin must be https — got ${rawOrigin}`);
  process.exit(1);
}

const origin = rawOrigin.replace(/\/$/, "");
const endpointUrl = `${origin}/api/webhook/ramp/${companyId}`;

async function main() {
  const serviceRole = getCarbonServiceRole();

  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) {
    throw new Error(
      `No usable Ramp integration for company ${companyId} (missing, or its ` +
        "metadata failed to parse)"
    );
  }
  const { client, metadata } = integration;
  const previousId = metadata.webhookId;

  console.log(`environment : ${metadata.credentials?.environment ?? "?"}`);
  console.log(`old webhook : ${previousId ?? "(none registered)"}`);
  console.log(`new endpoint: ${endpointUrl}`);

  const created = WebhookCreateResponse.parse(
    await client.createWebhook(
      {
        endpoint_url: endpointUrl,
        event_types: [...RAMP_WEBHOOK_EVENT_TYPES]
      },
      buildRampIdempotencyKey({
        companyId,
        operation: "createWebhook",
        scope: endpointUrl
      })
    )
  );

  if (created.id === previousId) {
    throw new Error(
      "Ramp replayed the previous webhook instead of creating one — the " +
        "endpoint URL was NOT changed. Do not treat this as success."
    );
  }
  if (!created.secret) {
    throw new Error(
      "Ramp returned no signing secret; refusing to persist. The webhook route " +
        "fails closed without one, so every delivery would 401."
    );
  }

  await patchRampWebhook(serviceRole, companyId, {
    webhookId: created.id,
    webhookSecret: created.secret
  });
  console.log(`new webhook : ${created.id}  (persisted with signing secret)`);

  if (previousId) {
    try {
      await client.deleteWebhook(previousId);
      console.log("deleted old webhook at Ramp");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\b404\b/.test(message)) {
        console.log("old webhook already absent at Ramp (404)");
      } else {
        // Non-fatal: the new webhook is live and persisted. Say so loudly
        // rather than failing and implying nothing changed.
        console.warn(
          `WARNING: could not delete old webhook ${previousId}: ${message}\n` +
            "The new webhook IS registered and stored; remove the old one in Ramp."
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
