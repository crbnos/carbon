import { createHmac, timingSafeEqual } from "node:crypto";

const HEX = /^[0-9a-f]*$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Constant-time check of an HMAC-SHA256 webhook signature over the RAW request
 * body. Shared by every provider that signs the body alone (Ramp: base64;
 * Linear and Jira: hex) — providers that sign a composite payload (Rillet,
 * Paperless Parts) build their own input.
 *
 * Fail-closed: an empty signature or secret, an undecodable signature, or a
 * length mismatch returns false. The length check runs BEFORE
 * `timingSafeEqual`, which throws on unequal lengths.
 */
export function verifyHmacSha256Signature(args: {
  signature: string;
  body: string;
  secret: string;
  encoding: "hex" | "base64";
}): boolean {
  const { body, secret, encoding } = args;
  const signature = args.signature?.trim();
  if (!signature || !secret) return false;

  // Buffer.from silently skips characters outside the alphabet ("hex" stops at
  // the first one, "base64" drops them), so a valid digest padded with junk
  // would decode to the valid digest. Refuse anything outside the alphabet.
  if (!(encoding === "hex" ? HEX : BASE64).test(signature)) return false;

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = createHmac("sha256", secret).update(body).digest();
    provided = Buffer.from(signature, encoding);
  } catch {
    return false;
  }

  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

/** Outcome of verifying one signed webhook delivery. `reason` is for logs only. */
export type WebhookVerification =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing-signature"
        | "invalid-signature"
        | "missing-timestamp"
        | "stale-timestamp";
    };
