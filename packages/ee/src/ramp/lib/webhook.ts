import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Ramp webhook delivery.
 *
 * SIGNING SCHEME (documented default, PENDING Task 1 verification): Ramp signs
 * the RAW request body with HMAC-SHA256 keyed by the per-webhook `secret` and
 * delivers the result base64-encoded in `X-Ramp-Signature`. Unlike Rillet there
 * is NO composite signed payload — Ramp signs the body only. If Task 1's sandbox
 * probe shows a different encoding (hex) or a composite payload, update this
 * function and this comment to match the recorded evidence.
 *
 * Comparison is constant-time; any decode failure returns false (fail-closed).
 */
export function verifyRampWebhookSignature(args: {
  signature: string;
  body: string;
  secret: string;
}): boolean {
  const { signature, body, secret } = args;
  if (!signature || !secret) return false;

  let expected: Buffer;
  try {
    expected = createHmac("sha256", secret).update(body).digest();
  } catch {
    return false;
  }

  let provided: Buffer;
  try {
    provided = Buffer.from(signature.trim(), "base64");
  } catch {
    return false;
  }

  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
