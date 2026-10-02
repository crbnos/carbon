// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  getAppUrl,
  ONSHAPE_CLIENT_ID,
  ONSHAPE_CLIENT_SECRET,
  ONSHAPE_OAUTH_REDIRECT_URL
} from "@carbon/env";
import {
  normalizeOnshapeUrl,
  ONSHAPE_DEFAULT_BASE_URL,
  ONSHAPE_DEFAULT_OAUTH_URL,
  ONSHAPE_GOVERNMENT_INTEGRATION_ID,
  ONSHAPE_GOVERNMENT_OAUTH_CALLBACK_PATH,
  type OnshapeIntegrationId
} from "./connection";

/**
 * Where to authorize, which client to authorize as, and which API host the
 * resulting token is good for.
 *
 * The public app's client lives in this Carbon instance's environment. A
 * Government customer's private app lives in THEIR Enterprise, so its client id,
 * secret and hosts come from the integration's own (vaulted) settings instead.
 */
export type OnshapeOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** API origin the token is issued for — stored on the connection as `baseUrl`. */
  baseUrl: string;
};

// Read for models/revisions/documents; Write to create translation (GLTF/PDF
// export) jobs and manage the release webhook subscription. Both must be
// granted to the OAuth application (the dev portal for the public app, the
// Enterprise's Developer settings for a private one), or Onshape refuses the
// authorization with `invalid_scope`.
export const ONSHAPE_OAUTH_SCOPES = ["OAuth2Read", "OAuth2Write"];

export function getOnshapeGovernmentRedirectUri(origin = getAppUrl()) {
  return `${origin}${ONSHAPE_GOVERNMENT_OAUTH_CALLBACK_PATH}`;
}

function oauthEndpoints(oauthUrl: string) {
  return {
    authorizeUrl: `${oauthUrl}/oauth/authorize`,
    tokenUrl: `${oauthUrl}/oauth/token`
  };
}

/**
 * Resolve the OAuth client for an Onshape connection, or null when it is not
 * configured. `metadata` must already have its vaulted secrets merged back
 * (`resolveIntegrationSecrets`) — the Government client secret is one of them.
 */
export function getOnshapeOAuthConfig(
  integrationId: OnshapeIntegrationId,
  metadata: Record<string, unknown> | null | undefined
): OnshapeOAuthConfig | null {
  if (integrationId === ONSHAPE_GOVERNMENT_INTEGRATION_ID) {
    const clientId = metadata?.clientId;
    const clientSecret = metadata?.clientSecret;
    const baseUrl = normalizeOnshapeUrl(metadata?.baseUrl);
    if (
      typeof clientId !== "string" ||
      !clientId.trim() ||
      typeof clientSecret !== "string" ||
      !clientSecret.trim() ||
      !baseUrl
    ) {
      return null;
    }
    return {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      redirectUri: getOnshapeGovernmentRedirectUri(),
      baseUrl,
      // A Government tenant serves OAuth from its own address.
      ...oauthEndpoints(baseUrl)
    };
  }

  if (
    !ONSHAPE_CLIENT_ID ||
    !ONSHAPE_CLIENT_SECRET ||
    !ONSHAPE_OAUTH_REDIRECT_URL
  ) {
    return null;
  }
  return {
    clientId: ONSHAPE_CLIENT_ID,
    clientSecret: ONSHAPE_CLIENT_SECRET,
    redirectUri: ONSHAPE_OAUTH_REDIRECT_URL,
    baseUrl: ONSHAPE_DEFAULT_BASE_URL,
    ...oauthEndpoints(ONSHAPE_DEFAULT_OAUTH_URL)
  };
}

/**
 * The URL that sends the user to Onshape to approve Carbon. The scope is
 * appended outside URLSearchParams so the delimiter is `%20`: RFC 6749 scope is
 * space-delimited, and URLSearchParams serializes a space as `+`, which only
 * means "space" under form-encoding rules a query string doesn't guarantee.
 */
export function getOnshapeAuthorizeUrl(
  config: OnshapeOAuthConfig,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state
  });
  const scope = ONSHAPE_OAUTH_SCOPES.join("%20");
  return `${config.authorizeUrl}?${params}&scope=${scope}`;
}

export type OnshapeTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
};

export class OnshapeTokenError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OnshapeTokenError";
    this.status = status;
  }
}

async function requestToken(
  config: OnshapeOAuthConfig,
  body: Record<string, string>
): Promise<OnshapeTokenResponse> {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });

  if (!response.ok) {
    throw new OnshapeTokenError(
      `Onshape token request failed (${response.status}): ${await response.text()}`,
      response.status
    );
  }

  return response.json();
}

export function exchangeOnshapeAuthorizationCode(
  config: OnshapeOAuthConfig,
  code: string
): Promise<OnshapeTokenResponse> {
  return requestToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri
  });
}

export function refreshOnshapeAccessToken(
  config: OnshapeOAuthConfig,
  refreshToken: string
): Promise<OnshapeTokenResponse> {
  return requestToken(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
}
