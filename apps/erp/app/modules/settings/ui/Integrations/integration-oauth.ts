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
