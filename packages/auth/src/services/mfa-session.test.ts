// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import type { AuthSession } from "../types";
import {
  completeMfaChallenge,
  getPendingMfaSession,
  requireAuthSession,
  setAuthSession,
  setPendingMfaSession
} from "./session.server";

// The module reads its configuration once, at import.
vi.hoisted(() => {
  vi.stubEnv("DOMAIN", "localhost");
  vi.stubEnv("CARBON_EDITION", "");
  vi.stubEnv("AUTH_COOKIE_SUFFIX", "");
  vi.stubEnv("CONTROLLED_ENVIRONMENT", "");
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

// Redis as an in-memory map.
const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("@carbon/kv", () => ({
  redis: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.set(key, value);
      return "OK";
    },
    del: async (key: string) => Number(kv.delete(key))
  }
}));

// GoTrue takes only a UUID as a user id.
const USER_ID = "8f7c1e5a-3b2d-4c6e-9a1f-0d2e4b6c8a10";
const VALID_CODE = "123456";
const FUTURE_EXPIRES_AT = 4102444800; // far enough that isExpiringSoon is false

// An access token GoTrue's client can decode; without `exp` it counts as
// expired, so seeding a client with it refreshes first.
const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const ACCESS_TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID })}.${b64({ signature: true })}`;

const user = { id: USER_ID, email: "jane@example.com" };

// GoTrue, answered over a stubbed fetch. `factors` is the user's enrolled
// factors; a challenge accepts only VALID_CODE and then issues AAL2 tokens.
const gotrue = {
  factors: [] as { id: string; factor_type: string; status: string }[],
  paths: [] as string[]
};
const verifiedTotp = [
  { id: "factor_1", factor_type: "totp", status: "verified" }
];

const fakeGoTrue = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  gotrue.paths.push(url.pathname);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  const session = (access_token: string, refresh_token: string) => ({
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: FUTURE_EXPIRES_AT,
    user
  });
  switch (url.pathname) {
    case "/auth/v1/token":
      return json(session("aal1-access", "aal1-refresh"));
    case "/auth/v1/user":
      return json(user);
    case `/auth/v1/admin/users/${USER_ID}/factors`:
      return json(gotrue.factors);
    case "/auth/v1/factors/factor_1/challenge":
      return json({
        id: "challenge_1",
        type: "totp",
        expires_at: FUTURE_EXPIRES_AT
      });
    case "/auth/v1/factors/factor_1/verify": {
      const { code } = JSON.parse(String(init?.body));
      return code === VALID_CODE
        ? json(session("aal2-access", "aal2-refresh"))
        : json(
            { code: "mfa_verification_failed", msg: "Invalid TOTP code" },
            422
          );
    }
    default:
      return json({}, 404);
  }
};

beforeEach(() => {
  kv.clear();
  gotrue.factors = [];
  gotrue.paths = [];
  vi.stubGlobal("fetch", fakeGoTrue);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => vi.unstubAllEnvs());

const makeSession = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  accessToken: ACCESS_TOKEN,
  refreshToken: "refresh-token",
  userId: USER_ID,
  companyId: "company_1",
  companyGroupId: "group_1",
  email: "jane@example.com",
  expiresIn: 3000,
  expiresAt: FUTURE_EXPIRES_AT,
  ...overrides
});

const requestWithCookie = (cookie: string, url = "http://localhost:3000/x") =>
  new Request(url, { headers: { Cookie: cookie } });

describe("pending MFA session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips the parked session and redirectTo", async () => {
    const authSession = makeSession();
    const cookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession, redirectTo: "/x/parts" }
    );

    const pending = await getPendingMfaSession(requestWithCookie(cookie));

    expect(pending?.authSession).toMatchObject({
      accessToken: ACCESS_TOKEN,
      userId: USER_ID
    });
    expect(pending?.redirectTo).toBe("/x/parts");
  });

  it("expires after ten minutes", async () => {
    const cookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession: makeSession() }
    );

    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(await getPendingMfaSession(requestWithCookie(cookie))).toBeNull();
  });

  it("is cleared when a full auth session is issued", async () => {
    const pendingCookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession: makeSession() }
    );

    const fullCookie = await setAuthSession(requestWithCookie(pendingCookie), {
      authSession: makeSession({ mfaVerified: true })
    });

    expect(
      await getPendingMfaSession(requestWithCookie(fullCookie))
    ).toBeNull();
  });
});

describe("completeMfaChallenge", () => {
  it("fails with no-session when nothing is parked or issued", async () => {
    const result = await completeMfaChallenge(
      new Request("http://localhost:3000/mfa", { method: "POST" }),
      VALID_CODE
    );

    expect(result).toEqual({ success: false, reason: "no-session" });
  });

  it("mints an mfaVerified session from a pending challenge", async () => {
    gotrue.factors = verifiedTotp;
    const pendingCookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession: makeSession(), redirectTo: "/x/parts" }
    );

    const result = await completeMfaChallenge(
      requestWithCookie(pendingCookie),
      VALID_CODE
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.authSession).toMatchObject({
        accessToken: "aal2-access",
        refreshToken: "aal2-refresh",
        mfaVerified: true
      });
      expect(result.redirectTo).toBe("/x/parts");
      // The cookie it returns holds the full session and no pending state.
      expect(
        await getPendingMfaSession(requestWithCookie(result.sessionCookie))
      ).toBeNull();
    }
  });

  it("falls back to the issued session when bounced by the re-check, keeping console mode", async () => {
    gotrue.factors = verifiedTotp;
    const staleCookie = await setAuthSession(
      new Request("http://localhost:3000/x"),
      { authSession: makeSession({ console: "company_1" }) }
    );

    const result = await completeMfaChallenge(
      requestWithCookie(staleCookie),
      VALID_CODE
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.authSession).toMatchObject({
        accessToken: "aal2-access",
        mfaVerified: true,
        console: "company_1"
      });
    }
  });

  it("rejects a wrong code", async () => {
    gotrue.factors = verifiedTotp;
    const pendingCookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession: makeSession() }
    );

    const result = await completeMfaChallenge(
      requestWithCookie(pendingCookie),
      "000000"
    );

    expect(result).toEqual({ success: false, reason: "invalid-code" });
  });

  it("ignores an unverified factor", async () => {
    gotrue.factors = [
      { id: "factor_1", factor_type: "totp", status: "unverified" }
    ];
    const pendingCookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession: makeSession() }
    );

    const result = await completeMfaChallenge(
      requestWithCookie(pendingCookie),
      VALID_CODE
    );

    expect(result).toEqual({ success: false, reason: "invalid-code" });
  });
});

describe("requireAuthSession MFA re-check", () => {
  const signedIn = (overrides: Partial<AuthSession> = {}) =>
    setAuthSession(new Request("http://localhost:3000/x"), {
      authSession: makeSession(overrides)
    });

  it("bounces an unverified session when the user has a factor", async () => {
    gotrue.factors = verifiedTotp;
    const cookie = await signedIn();

    const thrown = await requireAuthSession(requestWithCookie(cookie)).catch(
      (response: Response) => response
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toMatch(/^\/mfa\?/);
  });

  it("passes an mfaVerified session without a factor lookup", async () => {
    gotrue.factors = verifiedTotp;
    const cookie = await signedIn({ mfaVerified: true });

    const session = await requireAuthSession(requestWithCookie(cookie));

    expect(session.userId).toBe(USER_ID);
    expect(gotrue.paths).toEqual([]);
  });

  it("passes an unverified session when the user has no factor", async () => {
    const cookie = await signedIn();

    const session = await requireAuthSession(requestWithCookie(cookie));

    expect(session.userId).toBe(USER_ID);
  });
});
