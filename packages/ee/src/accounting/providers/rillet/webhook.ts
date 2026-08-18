import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Rillet webhook delivery headers. Every delivery carries all five; the
 * signature covers the dot-joined values of the other four plus the raw
 * body.
 */
export type RilletWebhookHeaders = {
  /** X-Rillet-Signature — base64 HMAC-SHA256, possibly comma-separated (token rotation, up to 10). */
  signature: string;
  /** X-Rillet-Timestamp — ISO-8601 dispatch time. */
  timestamp: string;
  /** X-Rillet-Id — unique delivery UUID (idempotency). */
  id: string;
  /** X-Rillet-Entity — object type, e.g. "invoice". */
  entity: string;
  /** X-Rillet-Event — action type, e.g. "payment-updated". */
  event: string;
};

/** The exact byte string Rillet signs: `$timestamp.$id.$entity.$event.$body`. */
export function buildRilletSignedPayload(
  headers: Omit<RilletWebhookHeaders, "signature">,
  body: string
): string {
  return `${headers.timestamp}.${headers.id}.${headers.entity}.${headers.event}.${body}`;
}

/**
 * Verify a Rillet webhook delivery against the per-webhook token
 * (base64-encoded, from Rillet → Organization Settings → Webhooks).
 *
 * The signature header may contain up to 10 comma-separated signatures
 * (token rotation); the delivery is valid if ANY matches. Comparison is
 * constant-time per candidate.
 */
export function verifyRilletWebhookSignature(args: {
  headers: RilletWebhookHeaders;
  body: string;
  token: string;
}): boolean {
  const { headers, body, token } = args;
  if (!headers.signature || !token) return false;

  let expected: Buffer;
  try {
    expected = createHmac("sha256", Buffer.from(token, "base64"))
      .update(buildRilletSignedPayload(headers, body))
      .digest();
  } catch {
    return false;
  }

  return headers.signature
    .split(",")
    .slice(0, 10)
    .some((candidate) => {
      let provided: Buffer;
      try {
        provided = Buffer.from(candidate.trim(), "base64");
      } catch {
        return false;
      }
      return (
        provided.length === expected.length &&
        timingSafeEqual(provided, expected)
      );
    });
}
