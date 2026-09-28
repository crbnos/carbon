import { verifyHmacSha256Signature } from "../../integrations/webhook-signature";

/**
 * Verify a Ramp webhook delivery.
 *
 * SIGNING SCHEME (PENDING Task 1 verification): Ramp signs the RAW request body
 * with HMAC-SHA256 keyed by the per-webhook `secret` and delivers the digest in
 * `X-Ramp-Signature`. Unlike Rillet there is NO composite signed payload — Ramp
 * signs the body only. The ENCODING is not pinned by any doc we can read, so both
 * hex and base64 are accepted (see below). Once Task 1's sandbox probe records
 * which one a real delivery uses, narrow this to that encoding and say so here.
 *
 * Comparison is constant-time; any decode failure returns false (fail-closed).
 */
export function verifyRampWebhookSignature(args: {
  signature: string;
  body: string;
  secret: string;
}): boolean {
  // Tolerate a scheme prefix (`sha256=<sig>`, `v1,<sig>`) — several providers
  // qualify the digest and Ramp's exact wire format is not pinned by a doc we
  // can read.
  const signature = args.signature?.trim().replace(/^(sha256=|v1[,=])/i, "");

  // Accept HEX or BASE64. Which one Ramp actually sends has never been confirmed
  // against a real delivery (the docs render client-side and the llms.txt bundle
  // omits the webhooks guide), and picking wrong fails CLOSED and SILENTLY: a hex
  // digest base64-decodes to 48 bytes against an expected 32, so the length guard
  // rejects every delivery and the endpoint can never complete Ramp's activation
  // challenge. Both candidates are HMACs of the same body under the same secret,
  // so trying both concedes nothing — an attacker still has to produce a correct
  // digest in one of two encodings, and each attempt goes through the same
  // alphabet-checked, constant-time primitive.
  return (["hex", "base64"] as const).some((encoding) =>
    verifyHmacSha256Signature({ ...args, signature, encoding })
  );
}
