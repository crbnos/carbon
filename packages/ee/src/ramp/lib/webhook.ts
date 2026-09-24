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

  // Tolerate a scheme prefix (`sha256=<sig>`, `v1,<sig>`) — several providers
  // qualify the digest and Ramp's exact wire format is not pinned by a doc we
  // can read.
  const raw = signature.trim().replace(/^(sha256=|v1[,=])/i, "");

  // Accept HEX or BASE64. Which one Ramp actually sends has never been
  // confirmed against a real delivery (the docs render client-side and the
  // llms.txt bundle omits the webhooks guide), and picking wrong fails CLOSED
  // and SILENTLY: a hex digest base64-decodes to 48 bytes against an expected
  // 32, so the length guard rejects every delivery and the endpoint can never
  // complete Ramp's activation challenge. Both candidates are HMACs of the same
  // body under the same secret, so trying both concedes nothing — an attacker
  // still has to produce a correct digest in one of two encodings.
  const candidates: Buffer[] = [];
  if (/^[0-9a-f]+$/i.test(raw) && raw.length === expected.length * 2) {
    candidates.push(Buffer.from(raw, "hex"));
  }
  try {
    candidates.push(Buffer.from(raw, "base64"));
  } catch {
    // ignore — the hex candidate may still match
  }

  return candidates.some(
    (provided) =>
      provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
