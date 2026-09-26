import { Edition } from "@carbon/utils";
import { createCookieSessionStorage } from "react-router";
import { CarbonEdition, DOMAIN, SESSION_SECRET } from "../config/env";
import { getCookieDomain } from "../utils/cookie";

const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const OAUTH_STATE_KEY = "oauth-state";

export type OAuthStatePayload = {
  integrationId: string;
  userId: string;
  companyId: string;
};

/**
 * Extra fields carried THROUGH the round trip rather than matched on it.
 *
 * `mode` decides which scopes were requested, so it must survive the redirect to
 * be stamped on the install afterwards — and it must travel in the SIGNED,
 * HttpOnly cookie, never a query parameter. A user-editable mode would let
 * someone consent to push-only's narrow scopes and have Carbon record the install
 * as provider mode, or the reverse.
 *
 * It is deliberately NOT part of the match: the callback has no independent copy
 * to compare against, so "matching" it would only compare the cookie to itself.
 */
export type OAuthStateExtras = {
  mode?: string;
};

type StoredOAuthState = OAuthStatePayload &
  OAuthStateExtras & {
    state: string;
    expiresAt: number;
  };

const isTestEdition = CarbonEdition === Edition.Test;
const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);

const oauthStateStorage = createCookieSessionStorage({
  cookie: {
    name: "carbon-oauth-state",
    httpOnly: true,
    path: "/",
    sameSite: isTestEdition ? "none" : "lax",
    secrets: [SESSION_SECRET!],
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS
  }
});

export async function issueOAuthState(
  payload: OAuthStatePayload & OAuthStateExtras
) {
  const session = await oauthStateStorage.getSession();
  const state = crypto.randomUUID();
  session.set(OAUTH_STATE_KEY, {
    ...payload,
    state,
    expiresAt: Date.now() + OAUTH_STATE_MAX_AGE_SECONDS * 1000
  } satisfies StoredOAuthState);

  return {
    state,
    cookie: await oauthStateStorage.commitSession(session, {
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS
    })
  };
}

export async function consumeOAuthState(
  request: Request,
  state: string,
  expected: OAuthStatePayload
) {
  const session = await oauthStateStorage.getSession(
    request.headers.get("Cookie")
  );
  const stored = session.get(OAUTH_STATE_KEY) as StoredOAuthState | undefined;

  const valid =
    !!stored &&
    stored.expiresAt > Date.now() &&
    stored.state === state &&
    stored.integrationId === expected.integrationId &&
    stored.userId === expected.userId &&
    stored.companyId === expected.companyId;

  return {
    valid,
    // State is single-use regardless of whether the supplied value matched.
    cookie: await oauthStateStorage.destroySession(session),
    /**
     * The stored payload, for fields the callback cannot re-derive — only when
     * the state was VALID. Returning it on an invalid state would hand the
     * caller attacker-supplied values that passed no check.
     */
    payload: valid
      ? ({ mode: stored?.mode } satisfies OAuthStateExtras)
      : undefined
  };
}
