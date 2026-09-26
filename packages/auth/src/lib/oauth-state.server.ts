import { Edition } from "@carbon/utils";
import { createCookieSessionStorage } from "react-router";
import { CarbonEdition, DOMAIN, SESSION_SECRET } from "../config/env";
import { getCookieDomain } from "../utils/cookie";

// Long enough to outlive an integrations page left open for a while: the state
// is issued when the page loads, not when Connect is clicked. It is single-use
// and bound to integration + user + company, so the lifetime is not what
// protects it.
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 60;
// A still-valid state with at least this much life left is handed out again
// instead of being replaced, so two tabs of the integrations page (or a page
// revalidation) do not invalidate each other's Connect links.
const OAUTH_STATE_REUSE_MIN_REMAINING_MS =
  (OAUTH_STATE_MAX_AGE_SECONDS * 1000) / 2;
// One entry per integration, so several connect flows can be in flight at once.
const OAUTH_STATES_KEY = "oauth-states";
// The pre-keyed shape held a single state; read it so a flow started before
// the upgrade still completes.
const LEGACY_OAUTH_STATE_KEY = "oauth-state";

export type OAuthStatePayload = {
  integrationId: string;
  userId: string;
  companyId: string;
};

type StoredOAuthState = OAuthStatePayload & {
  state: string;
  expiresAt: number;
};

type StoredOAuthStates = Record<string, StoredOAuthState>;

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

type OAuthStateSession = Awaited<
  ReturnType<typeof oauthStateStorage.getSession>
>;

function isStoredOAuthState(value: unknown): value is StoredOAuthState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === "string" &&
    typeof v.integrationId === "string" &&
    typeof v.userId === "string" &&
    typeof v.companyId === "string" &&
    typeof v.expiresAt === "number"
  );
}

/** The live (unexpired) states in the session, keyed by integration. */
function readStates(session: OAuthStateSession): StoredOAuthStates {
  const states: StoredOAuthStates = {};
  const now = Date.now();

  const legacy = session.get(LEGACY_OAUTH_STATE_KEY);
  if (isStoredOAuthState(legacy) && legacy.expiresAt > now) {
    states[legacy.integrationId] = legacy;
  }

  const stored = session.get(OAUTH_STATES_KEY);
  if (stored && typeof stored === "object") {
    for (const [integrationId, value] of Object.entries(stored)) {
      if (
        isStoredOAuthState(value) &&
        value.integrationId === integrationId &&
        value.expiresAt > now
      ) {
        states[integrationId] = value;
      }
    }
  }

  return states;
}

async function commitStates(
  session: OAuthStateSession,
  states: StoredOAuthStates
) {
  session.unset(LEGACY_OAUTH_STATE_KEY);
  if (Object.keys(states).length === 0) {
    return oauthStateStorage.destroySession(session);
  }
  session.set(OAUTH_STATES_KEY, states);
  return oauthStateStorage.commitSession(session, {
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS
  });
}

/**
 * Issue a state per payload, keeping every other integration's pending state
 * already in the request's cookie. Returns the states keyed by integration id
 * and ONE Set-Cookie value that carries all of them.
 */
export async function issueOAuthStates(
  request: Request | null,
  payloads: OAuthStatePayload[]
) {
  const session = await oauthStateStorage.getSession(
    request?.headers.get("Cookie")
  );
  const states = readStates(session);
  const now = Date.now();
  const issued: Record<string, string> = {};

  for (const payload of payloads) {
    const existing = states[payload.integrationId];
    const reusable =
      !!existing &&
      existing.userId === payload.userId &&
      existing.companyId === payload.companyId &&
      existing.expiresAt - now >= OAUTH_STATE_REUSE_MIN_REMAINING_MS;

    if (reusable) {
      issued[payload.integrationId] = existing.state;
      continue;
    }

    const state = crypto.randomUUID();
    states[payload.integrationId] = {
      ...payload,
      state,
      expiresAt: now + OAUTH_STATE_MAX_AGE_SECONDS * 1000
    };
    issued[payload.integrationId] = state;
  }

  return {
    states: issued,
    cookie: await commitStates(session, states)
  };
}

/**
 * Issue one integration's state. Pass the request so other integrations'
 * pending states in its cookie survive the new Set-Cookie.
 */
export async function issueOAuthState(
  payload: OAuthStatePayload,
  request: Request | null = null
) {
  const { states, cookie } = await issueOAuthStates(request, [payload]);
  return { state: states[payload.integrationId]!, cookie };
}

/**
 * Check a callback's `state` against the one stored for `expected.integrationId`
 * and remove it — single-use whether or not it matched. Other integrations'
 * pending states are left in place.
 */
export async function consumeOAuthState(
  request: Request,
  state: string,
  expected: OAuthStatePayload
) {
  const session = await oauthStateStorage.getSession(
    request.headers.get("Cookie")
  );
  const states = readStates(session);
  const stored = states[expected.integrationId];

  const valid =
    !!stored &&
    !!state &&
    stored.expiresAt > Date.now() &&
    stored.state === state &&
    stored.integrationId === expected.integrationId &&
    stored.userId === expected.userId &&
    stored.companyId === expected.companyId;

  delete states[expected.integrationId];

  return {
    valid,
    cookie: await commitStates(session, states)
  };
}
