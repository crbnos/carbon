import {
  verifyHmacSha256Signature,
  type WebhookVerification
} from "../../integrations/webhook-signature";

/** Linear's documented replay window: reject deliveries older than 60 s. */
export const LINEAR_WEBHOOK_TOLERANCE_MS = 60_000;

/**
 * Verify a Linear webhook delivery against the webhook's signing secret
 * (shown on the webhook's detail page in Linear).
 *
 * Scheme (https://linear.app/developers/webhooks, "Securing webhooks"):
 * `Linear-Signature` is the hex HMAC-SHA256 of the RAW request body keyed by
 * the signing secret. The JSON body carries `webhookTimestamp` (UNIX ms); a
 * delivery more than 60 s from now is rejected so a captured request cannot
 * be replayed. The timestamp is inside the signed body, so it cannot be
 * altered without breaking the signature.
 */
export function verifyLinearWebhook(args: {
  signature: string | null;
  body: string;
  secret: string;
  now?: number;
}): WebhookVerification {
  const { signature, body, secret } = args;
  if (!signature) return { ok: false, reason: "missing-signature" };

  if (
    !verifyHmacSha256Signature({ signature, body, secret, encoding: "hex" })
  ) {
    return { ok: false, reason: "invalid-signature" };
  }

  const timestamp = readWebhookTimestamp(body);
  if (timestamp === null) return { ok: false, reason: "missing-timestamp" };

  const now = args.now ?? Date.now();
  if (Math.abs(now - timestamp) > LINEAR_WEBHOOK_TOLERANCE_MS) {
    return { ok: false, reason: "stale-timestamp" };
  }

  return { ok: true };
}

function readWebhookTimestamp(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const value =
      parsed && typeof parsed === "object"
        ? (parsed as { webhookTimestamp?: unknown }).webhookTimestamp
        : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
