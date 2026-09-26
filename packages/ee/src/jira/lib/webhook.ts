import {
  verifyHmacSha256Signature,
  type WebhookVerification
} from "../../integrations/webhook-signature";

/**
 * Verify a Jira Cloud admin-webhook delivery against the "Secret" entered on
 * the webhook in Jira (System → WebHooks).
 *
 * Scheme (https://developer.atlassian.com/cloud/jira/platform/webhooks/,
 * "Secure admin webhooks"): `X-Hub-Signature` is `method=signature`, e.g.
 * `sha256=<hex HMAC-SHA256 of the raw body keyed by the secret>`. Only
 * `sha256` is accepted. Jira sends no timestamp header and the payload's
 * `timestamp` is not a documented freshness guarantee, so there is no replay
 * window — the sync job re-fetches the issue from Jira, so a replayed
 * delivery can only re-apply Jira's current state.
 */
export function verifyJiraWebhook(args: {
  signature: string | null;
  body: string;
  secret: string;
}): WebhookVerification {
  const { signature, body, secret } = args;
  if (!signature) return { ok: false, reason: "missing-signature" };

  const separator = signature.indexOf("=");
  const method = signature.slice(0, separator).trim().toLowerCase();
  const digest = signature.slice(separator + 1);
  if (separator < 1 || method !== "sha256") {
    return { ok: false, reason: "invalid-signature" };
  }

  return verifyHmacSha256Signature({
    signature: digest,
    body,
    secret,
    encoding: "hex"
  })
    ? { ok: true }
    : { ok: false, reason: "invalid-signature" };
}
