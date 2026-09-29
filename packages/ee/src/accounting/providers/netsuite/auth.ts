import { createHmac, randomBytes } from "node:crypto";

const SIGNATURE_METHOD = "HMAC-SHA256";

export function oauthEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/** SuiteTalk host. `1234567_SB1` and `1234567-sb1` both become the same origin. */
export function netsuiteOrigin(accountId: string): string {
  const host = accountId.trim().toLowerCase().replace(/_/g, "-");
  return `https://${host}.suitetalk.api.netsuite.com`;
}

/** OAuth realm. Hyphens become underscores and the id is uppercased. */
export function netsuiteRealm(accountId: string): string {
  return accountId.trim().toUpperCase().replace(/-/g, "_");
}

export function netSuiteSignatureBaseString(args: {
  method: string;
  url: string;
  consumerKey: string;
  tokenId: string;
  nonce: string;
  timestamp: string;
}): string {
  const queryIndex = args.url.indexOf("?");
  const baseUrl = queryIndex === -1 ? args.url : args.url.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : args.url.slice(queryIndex + 1);

  const pairs: Array<[string, string]> = [
    ["oauth_consumer_key", args.consumerKey],
    ["oauth_nonce", args.nonce],
    ["oauth_signature_method", SIGNATURE_METHOD],
    ["oauth_timestamp", args.timestamp],
    ["oauth_token", args.tokenId],
    ["oauth_version", "1.0"]
  ];

  if (query) {
    for (const part of query.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const key = eq === -1 ? part : part.slice(0, eq);
      const value = eq === -1 ? "" : part.slice(eq + 1);
      pairs.push([decodeURIComponent(key), decodeURIComponent(value)]);
    }
  }

  pairs.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });

  const paramString = pairs
    .map(([key, value]) => `${oauthEncode(key)}=${oauthEncode(value)}`)
    .join("&");

  return [
    args.method.toUpperCase(),
    oauthEncode(baseUrl),
    oauthEncode(paramString)
  ].join("&");
}

export function signNetSuiteRequest(args: {
  method: string;
  url: string;
  realm: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  nonce?: string;
  timestamp?: string;
}): { authorization: string; nonce: string; timestamp: string } {
  const nonce = args.nonce ?? randomBytes(16).toString("hex");
  // Date.now() is 13 digits until 2286; dropping the last three is unix seconds.
  const timestamp = args.timestamp ?? String(Date.now()).slice(0, -3);
  const baseString = netSuiteSignatureBaseString({
    method: args.method,
    url: args.url,
    consumerKey: args.consumerKey,
    tokenId: args.tokenId,
    nonce,
    timestamp
  });
  const key = `${oauthEncode(args.consumerSecret)}&${oauthEncode(args.tokenSecret)}`;
  const signature = createHmac("sha256", key)
    .update(baseString)
    .digest("base64");

  const header = [
    `realm="${oauthEncode(args.realm)}"`,
    `oauth_consumer_key="${oauthEncode(args.consumerKey)}"`,
    `oauth_token="${oauthEncode(args.tokenId)}"`,
    `oauth_signature_method="${SIGNATURE_METHOD}"`,
    `oauth_timestamp="${timestamp}"`,
    `oauth_nonce="${oauthEncode(nonce)}"`,
    `oauth_version="1.0"`,
    `oauth_signature="${oauthEncode(signature)}"`
  ].join(",");

  return { authorization: `OAuth ${header}`, nonce, timestamp };
}
