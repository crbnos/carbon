import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  completeWebhookVerification,
  getRampIntegration,
  RampWebhookEventSchema,
  verifyRampWebhookSignature
} from "@carbon/ee/ramp.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

// Needs node:crypto for the constant-time HMAC comparison in
// verifyRampWebhookSignature.
export const config = { runtime: "nodejs" };

const logger = getLogger("erp", "webhook-ramp");

/**
 * Receives Ramp webhook deliveries for one company. Ramp is registered against
 * `${origin}/api/webhook/ramp/${companyId}` by `ensureRampWebhook` (the install
 * hook). A delivery is only a *nudge*: it triggers the same `ramp-sync` job the
 * hourly `ramp-sweep` cron fires, so the sync body itself is the source of truth
 * and the webhook is pure latency (a lost delivery becomes ≤1h of staleness, not
 * lost data). We ack fast; the job drains the SYNC_READY queues.
 *
 * SIGNING / CHALLENGE (documented defaults, PENDING Task 1 sandbox verification):
 * Ramp signs the RAW body with HMAC-SHA256 keyed by the per-webhook secret,
 * base64, in `X-Ramp-Signature`. Webhook-ownership verification arrives as a
 * signed body carrying a `challenge` string, which we answer via
 * `completeWebhookVerification` and echo back. Query parameters are not signed
 * and cannot supply a challenge. If Task 1 shows a different header
 * name, encoding, or challenge shape, update the marked spots here and
 * `packages/ee/src/ramp/lib/webhook.ts`.
 */

/** Health-check for the URL pasted into / probed by Ramp (GET). */
export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.companyId) {
    return data({ success: false }, { status: 400 });
  }
  return { success: true };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  // Raw body FIRST — the signature covers the exact bytes, not re-serialized
  // JSON.
  const body = await request.text();

  const serviceRole = getCarbonServiceRole();
  // Loads only an active `ramp` integration and resolves its vaulted secrets
  // (incl. `webhookSecret`); returns null when not installed/active.
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) {
    return data({ success: false }, { status: 404 });
  }
  const { metadata } = integration;

  // Every delivery, including an ownership challenge, requires a stored secret
  // and a valid signature before it can call Ramp or echo authenticated data.
  const signature = request.headers.get("x-ramp-signature");
  if (!signature || !metadata.webhookSecret) {
    return data({ success: false }, { status: 401 });
  }
  const verified = verifyRampWebhookSignature({
    signature,
    body,
    secret: metadata.webhookSecret
  });
  if (!verified) {
    return data({ success: false }, { status: 401 });
  }

  const challenge = extractChallenge(body);
  if (challenge) {
    try {
      await completeWebhookVerification(serviceRole, companyId, challenge);
    } catch (error) {
      // Non-fatal: still echo the authenticated challenge for an echo handshake.
      logger.error("Ramp webhook verify callback failed", { companyId, error });
    }
    return { challenge };
  }

  // Parse leniently; unrecognized events are acknowledged, never rejected
  // (forward-compat). The event id/type only decide whether to nudge the sync —
  // the job re-derives everything from Ramp, so no payload threading is needed.
  const parsed = RampWebhookEventSchema.safeParse(safeJsonParse(body));
  if (!parsed.success) {
    logger.error("Invalid Ramp webhook payload", { companyId });
    return data({ success: false }, { status: 400 });
  }

  await trigger("ramp-sync", { companyId, reason: "webhook" });

  logger.info("Triggered Ramp sync from webhook", {
    companyId,
    eventId: parsed.data.id,
    eventType: parsed.data.type
  });

  return { success: true };
}

function safeJsonParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Pull a webhook-verification challenge only from the authenticated body.
 * Ramp's exact challenge shape still requires sandbox verification.
 */
function extractChallenge(body: string): string | null {
  const parsed = safeJsonParse(body);
  if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { challenge?: unknown }).challenge === "string"
  ) {
    return (parsed as { challenge: string }).challenge;
  }
  return null;
}
