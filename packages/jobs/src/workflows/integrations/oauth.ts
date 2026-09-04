import type { OAuth2RefreshConfig } from "@carbon/ee/integrations/connections";
import { getEnv } from "@carbon/env";
import { type AllowlistEntry, PIECE_ALLOWLIST } from "./allowlist";
import { getPieceOAuth2Auth } from "./registry";
import type { OAuth2AuthDeclaration } from "./types";

/** The OAuth app credentials belong to Carbon, not to the piece: the piece knows
 * the vendor's URLs and scopes, we know the app we registered with that vendor. */

export interface PieceOAuthApp {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

/**
 * Carbon's OAuth app for one piece, read by the env var NAMES on its allowlist row.
 *
 * Looked up dynamically rather than imported as constants, because the set of
 * vendors is data. `getEnv` is the sanctioned accessor; this module is server-only,
 * so it always resolves against `process.env`.
 *
 * Throws when the server has no app configured for the piece. That is the whole
 * point of the refusal: a half-configured vendor must fail here rather than send a
 * customer to a consent screen that cannot come back.
 */
export function resolveOAuthApp(pieceName: string): PieceOAuthApp {
  const entry: AllowlistEntry | undefined = PIECE_ALLOWLIST[pieceName];
  if (entry === undefined) {
    throw new Error(`No OAuth app is configured for ${pieceName}.`);
  }

  const clientId = getEnv(entry.oauth.clientIdEnv, { isRequired: false });
  const clientSecret = getEnv(entry.oauth.clientSecretEnv, {
    isRequired: false,
    isSecret: true
  });
  const redirectUrl = getEnv(entry.oauth.redirectUrlEnv, { isRequired: false });

  if (!clientId || !clientSecret || !redirectUrl) {
    throw new Error(`No OAuth app is configured for ${pieceName}.`);
  }

  return { clientId, clientSecret, redirectUrl };
}

export async function buildRefreshConfig(
  pieceName: string
): Promise<OAuth2RefreshConfig> {
  const auth = await getPieceOAuth2Auth(pieceName);
  const { clientId, clientSecret } = resolveOAuthApp(pieceName);
  return { tokenUrl: auth.tokenUrl, clientId, clientSecret };
}

/**
 * The vendor consent URL. The piece supplies `authUrl` and `scope`; an allowlist row
 * may override either — Slack's piece bakes `user_scope=` into its URL and asks for
 * 30 bot scopes; the row lists exactly the scopes Carbon uses.
 */
export function buildConsentUrl(args: {
  entry: Pick<AllowlistEntry, "oauth">;
  auth: Pick<OAuth2AuthDeclaration, "authUrl" | "scope">;
  app: Pick<PieceOAuthApp, "clientId" | "redirectUrl">;
  state: string;
}): string {
  const url = new URL(args.entry.oauth.authUrl ?? args.auth.authUrl);
  url.searchParams.set("client_id", args.app.clientId);
  url.searchParams.set("redirect_uri", args.app.redirectUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    (args.entry.oauth.scope ?? args.auth.scope).join(" ")
  );
  // Without both of these Google returns no refresh token on a re-authorization.
  // Slack ignores them.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", args.state);
  return url.toString();
}

/** The scopes a connection for this piece must hold — exactly what `buildConsentUrl`
 * requests, so "reconnect" always grants what the check demands. */
export async function requiredScopesFor(
  pieceName: string
): Promise<readonly string[]> {
  const entry = PIECE_ALLOWLIST[pieceName];
  if (entry === undefined) return [];
  return entry.oauth.scope ?? (await getPieceOAuth2Auth(pieceName)).scope;
}

/** A scalar at a dot path in a token response, or undefined. */
function scalarAt(
  body: Record<string, unknown>,
  path: string
): string | number | boolean | undefined {
  let cursor: unknown = body;
  for (const key of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ||
    typeof cursor === "number" ||
    typeof cursor === "boolean"
    ? cursor
    : undefined;
}

/** The connection's metadata, picked from the token response by the row's declared
 * paths. Absent or non-scalar paths are omitted; nothing undeclared is copied. */
export function connectionMetadataFrom(
  entry: Pick<AllowlistEntry, "metadata">,
  body: Record<string, unknown>
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(entry.metadata ?? {})) {
    const value = scalarAt(body, path);
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

/** The account label when the row reads it off the token response; null otherwise
 * (the callback then falls back to the vendor identity endpoint, if declared). */
export function accountLabelFromBody(
  entry: Pick<AllowlistEntry, "accountLabel">,
  body: Record<string, unknown>
): string | null {
  const label = entry.accountLabel;
  if (label === undefined || !("path" in label)) return null;
  const value = scalarAt(body, label.path);
  return typeof value === "string" && value.length > 0 ? value : null;
}
