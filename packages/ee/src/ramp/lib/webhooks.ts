import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveIntegrationSecrets } from "../../integrations/secrets";
import { buildRampIdempotencyKey } from "./client";
import {
  buildRampClient,
  getRampIntegration,
  RAMP,
  readStoredRampMetadata
} from "./connection";
import { RampIntegrationMetadataSchema } from "./models";
import { patchRampWebhook } from "./state";

/**
 * Webhook events Carbon subscribes to on install (spec §Install step 5). The
 * ready-to-sync / updated / paid events are what drive the `ramp-sync` pulls.
 */
export const RAMP_WEBHOOK_EVENT_TYPES = [
  "transactions.ready_to_sync",
  "transactions.cleared",
  "bills.ready_to_sync",
  "bills.updated",
  "bills.paid",
  "payments.updated",
  "reimbursements.ready_to_sync",
  "purchase_orders.updated"
] as const;

/** The webhook-create response Carbon reads (`id` + signing `secret`). */
const RampWebhookCreateResponseSchema = z
  .object({
    id: z.string(),
    secret: z.string().optional()
  })
  .passthrough();

// /********************************************************\
// *                       Webhook                         *
// \********************************************************/

/**
 * Ensure a Ramp webhook is registered for the company. Idempotent: skips when
 * `metadata.webhookId` is already set. On create, persists the `webhookId` to the
 * metadata column and the returned signing `secret` to the vault (under the
 * `webhookSecret` SECRET_KEYS path) in the same atomic patch.
 * `originUrl` is the app origin, supplied by the caller.
 */
export async function ensureRampWebhook(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  originUrl: string
): Promise<{ webhookId: string } | null> {
  const stored = await readStoredRampMetadata(serviceRole, companyId);
  if (!stored) return null;

  const resolved = await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    RAMP,
    stored
  );
  const parsed = RampIntegrationMetadataSchema.safeParse(resolved);
  if (!parsed.success) return null;

  if (parsed.data.webhookId) return { webhookId: parsed.data.webhookId };

  // Build via the shared helper so an oauth2 connection whose access token has
  // expired can refresh it before the webhook call (a bare `new RampClient` has
  // no OAuth app and would throw on an expired token).
  const client = buildRampClient(
    serviceRole,
    companyId,
    parsed.data.credentials
  );
  const created = RampWebhookCreateResponseSchema.parse(
    await client.createWebhook(
      {
        endpoint_url: `${originUrl}/api/webhook/ramp/${companyId}`,
        event_types: [...RAMP_WEBHOOK_EVENT_TYPES]
      },
      // Entity-scoped idempotency key — one webhook per company connection, so a
      // retried install cannot register a duplicate webhook at Ramp.
      buildRampIdempotencyKey({
        companyId,
        operation: "createWebhook",
        scope: companyId
      })
    )
  );

  // The webhook route fails closed without a stored signing secret (401), and a
  // persisted `webhookId` makes this function skip re-creation forever. So
  // refuse to persist a webhook Ramp returned without a secret — leaving the
  // metadata clean means the next run re-creates one we can actually verify.
  if (!created.secret) {
    throw new Error(
      "Ramp did not return a webhook signing secret; not persisting the webhook"
    );
  }

  await patchRampWebhook(serviceRole, companyId, {
    webhookId: created.id,
    webhookSecret: created.secret
  });

  return { webhookId: created.id };
}

/**
 * Answer Ramp's webhook challenge verification for the registered webhook.
 * Returns `false` when there is no registered webhook to verify.
 */
export async function completeWebhookVerification(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  challenge: string
): Promise<boolean> {
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return false;

  const { client, metadata } = integration;
  if (!metadata.webhookId) return false;

  await client.verifyWebhook(metadata.webhookId, challenge);
  return true;
}
