import type { OAuth2RefreshConfig } from "@carbon/ee/integrations/connections";
import { getEnv } from "@carbon/env";
import { type AllowlistEntry, PIECE_ALLOWLIST } from "./allowlist";
import { getPieceOAuth2Auth } from "./registry";

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
