import { getLogger } from "@carbon/logger";
import type { User } from "@supabase/supabase-js";
import { decodeJwt } from "jose";

const log = getLogger("ee");

/**
 * The SSO provider id from a user's IDENTITY LIST, or null when no SSO identity
 * exists. GoTrue records SAML identities with provider "sso:<providerId>"; the
 * same value appears on app_metadata.provider for SSO-only users.
 *
 * WARNING: this answers "does this user HAVE an SSO identity", NOT "did this
 * session authenticate via SSO". Once an account is linked, its permanent
 * "sso:" identity makes every login — including Google OAuth and magic link —
 * look like SSO through this lens. Session classification (Require SSO
 * enforcement, MFA skip) must use getSsoProviderIdFromSession, which reads the
 * session's own `amr` claim.
 */
export function getSsoProviderIdFromUser(user: User): string | null {
  for (const identity of user.identities ?? []) {
    if (identity.provider?.startsWith("sso:")) {
      return identity.provider.slice("sso:".length);
    }
  }
  const provider = user.app_metadata?.provider;
  if (typeof provider === "string" && provider.startsWith("sso:")) {
    return provider.slice("sso:".length);
  }
  return null;
}

/**
 * The SSO provider id for THIS SESSION, or null when the session did not
 * authenticate via SAML — regardless of what identities the user has linked.
 *
 * Classification comes from the session JWT's `amr` claim (GoTrue: an array of
 * `{ method, timestamp }`; a SAML login carries `method: "sso/saml"`). Only
 * when the session is genuinely SAML-authenticated is the provider id resolved
 * from the user's identity list. A linked account's Google/magic-link login has
 * the "sso:" identity but no "sso/saml" amr entry, and correctly returns null.
 *
 * The token is decoded WITHOUT verification: it was just minted for us by
 * GoTrue via the service role, so its integrity is not in question here — only
 * its claims are read. Defensive failures (undecodable token, missing amr)
 * return null, failing CLOSED toward the non-SSO path where Require SSO
 * enforcement lives.
 */
export function getSsoProviderIdFromSession(
  accessToken: string,
  user: User
): string | null {
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwt(accessToken);
  } catch {
    log.info(
      "SSO session check: access token could not be decoded; treating session as non-SSO"
    );
    return null;
  }

  const amr = payload.amr;
  if (!Array.isArray(amr)) {
    // Unexpected on GoTrue v2.189 — a genuine SAML login always carries amr.
    log.info(
      "SSO session check: amr claim missing from access token; treating session as non-SSO"
    );
    return null;
  }

  const isSamlSession = amr.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { method?: unknown }).method === "sso/saml"
  );
  if (!isSamlSession) return null;

  return getSsoProviderIdFromUser(user);
}
