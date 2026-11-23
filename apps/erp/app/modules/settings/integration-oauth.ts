// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

type IntegrationOAuthConfig = {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
};

export function buildIntegrationOAuthUrl(
  oauth: IntegrationOAuthConfig,
  state: string | undefined,
  origin: string
): string | null {
  if (!state) return null;

  const url = new URL(oauth.authUrl);
  url.searchParams.set("client_id", oauth.clientId);
  url.searchParams.set("redirect_uri", `${origin}${oauth.redirectUri}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", oauth.scopes.join(" "));
  return url.toString();
}

export type XeroConnection = {
  id: string;
  authEventId?: string;
  tenantId: string;
  tenantName?: string | null;
};

/** The `authentication_event_id` claim of a Xero access token (a JWT), or null. */
export function xeroAuthEventId(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof claims?.authentication_event_id === "string"
      ? claims.authentication_event_id
      : null;
  } catch {
    return null;
  }
}

/**
 * The organisation the user picked in this authorisation: the connection made
 * by this auth event. Earlier connections stay listed, so the first entry is
 * not necessarily the one just chosen.
 */
export function pickXeroConnection(
  connections: ReadonlyArray<XeroConnection>,
  authEventId: string | null
): XeroConnection | null {
  const fromThisAuth = authEventId
    ? connections.find((c) => c.authEventId === authEventId)
    : undefined;
  return fromThisAuth ?? connections[0] ?? null;
}
