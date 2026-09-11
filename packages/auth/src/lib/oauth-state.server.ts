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

type StoredOAuthState = OAuthStatePayload & {
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

export async function issueOAuthState(payload: OAuthStatePayload) {
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
    cookie: await oauthStateStorage.destroySession(session)
  };
}
