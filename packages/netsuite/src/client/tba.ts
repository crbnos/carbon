import { createHmac, randomBytes } from "node:crypto";

import { accountRealm } from "./account.ts";

/**
 * Token-Based Authentication — NetSuite's OAuth 1.0a with HMAC-SHA256.
 *
 * TBA is what a migration realistically runs on: it needs no browser redirect,
 * no certificate upload, and no token refresh, so a customer can hand over four
 * strings from one Integration record and one Access Token and the migration can
 * run unattended for as long as it takes.
 *
 * Three details are the difference between a working signature and an opaque
 * `INVALID_LOGIN_ATTEMPT`:
 *   1. The realm is the UPPERCASE underscore account id, not the DNS label.
 *   2. Query parameters participate in the signature base string, sorted by
 *      encoded key then encoded value — so the signer has to be handed the URL
 *      with its query already built, never the bare path.
 *   3. Percent-encoding is RFC 3986, which `encodeURIComponent` almost does:
 *      it leaves `!*'()` unescaped and NetSuite rejects the result.
 */

export type TbaCredentials = {
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
};

/** RFC 3986 percent-encoding (`encodeURIComponent` plus `!*'()`). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function signatureBaseString(
  method: string,
  url: URL,
  oauthParams: Record<string, string>
): string {
  const params: [string, string][] = [];
  for (const [key, value] of url.searchParams.entries()) {
    params.push([percentEncode(key), percentEncode(value)]);
  }
  for (const [key, value] of Object.entries(oauthParams)) {
    params.push([percentEncode(key), percentEncode(value)]);
  }
  params.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
  );

  const normalized = params.map(([k, v]) => `${k}=${v}`).join("&");
  // The base URL for signing excludes the query string and any default port.
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

  return [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalized)
  ].join("&");
}

/**
 * Build the `Authorization: OAuth ...` header for one request.
 *
 * `nonce` and `timestamp` are injectable so the signature is reproducible in a
 * test — production callers omit them.
 */
export function signTbaRequest(
  credentials: TbaCredentials,
  method: string,
  url: string | URL,
  options: { nonce?: string; timestamp?: number } = {}
): string {
  const parsed = url instanceof URL ? url : new URL(url);

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: options.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: credentials.tokenId,
    oauth_version: "1.0"
  };

  const signingKey = `${percentEncode(credentials.consumerSecret)}&${percentEncode(
    credentials.tokenSecret
  )}`;
  const signature = createHmac("sha256", signingKey)
    .update(signatureBaseString(method, parsed, oauthParams))
    .digest("base64");

  const header = Object.entries({ ...oauthParams, oauth_signature: signature })
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth realm="${accountRealm(credentials.accountId)}", ${header}`;
}
