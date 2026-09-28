import { verifyHmacSha256Signature } from "../../integrations/webhook-signature";

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
  return verifyHmacSha256Signature({ ...args, encoding: "base64" });
}
