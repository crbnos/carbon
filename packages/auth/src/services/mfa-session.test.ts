import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Isolation mocks ───────────────────────────────────────────────────────
// session.server's siblings pull in supabase/env at module load; stub them so
// the cookie/session logic under test runs against the real react-router
// session storage only.
vi.mock("@carbon/kv", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null)
  }
}));

vi.mock("../config/env", () => ({
  DOMAIN: "localhost",
  CarbonEdition: "Community",
  CONTROLLED_ENVIRONMENT: false,
  REFRESH_ACCESS_TOKEN_THRESHOLD: 60,
  SESSION_ABSOLUTE_MAX_MS: 12 * 60 * 60 * 1000,
  SESSION_IDLE_LOCK_MS: 15 * 60 * 1000,
  SESSION_KEY: "auth",
  SESSION_MAX_AGE: 60 * 60 * 24 * 7,
  SESSION_SECRET: "test-session-secret"
}));

vi.mock("./auth.server", () => ({
  makeAuthSession: vi.fn(
    (
      supabaseSession: any,
      companyId: string,
      companyGroupId: string,
      options?: { mfaVerified?: boolean }
    ) =>
      supabaseSession
        ? {
            accessToken: supabaseSession.access_token,
            refreshToken: supabaseSession.refresh_token,
            userId: supabaseSession.user.id,
            email: supabaseSession.user.email,
            companyId,
            companyGroupId,
            expiresIn: 3000,
            expiresAt: supabaseSession.expires_at,
            ...(options?.mfaVerified ? { mfaVerified: true } : {})
          }
        : null
  ),
  refreshAccessToken: vi.fn(),
  verifyAuthSession: vi.fn().mockResolvedValue(true),
  logAuthEvent: vi.fn()
}));

vi.mock("./company.server", () => ({
  setCompanyId: vi.fn(() => "companyId=cookie")
}));

vi.mock("./mfa.server", () => ({
  getTotpFactors: vi.fn().mockResolvedValue([]),
  userHasVerifiedTotpFactor: vi.fn().mockResolvedValue(false),
  verifyTotpChallenge: vi.fn().mockResolvedValue(null)
}));

vi.mock("./users", () => ({
  getPermissionCacheKey: (userId: string) => `permissions:${userId}`
}));

import type { AuthSession } from "../types";
import {
  getTotpFactors,
  userHasVerifiedTotpFactor,
  verifyTotpChallenge
} from "./mfa.server";
import {
  completeMfaChallenge,
  getPendingMfaSession,
  requireAuthSession,
  setAuthSession,
  setPendingMfaSession
} from "./session.server";

const FUTURE_EXPIRES_AT = 4102444800; // far enough that isExpiringSoon is false

const makeSession = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  accessToken: "access-token",
  refreshToken: "refresh-token",
  userId: "user_1",
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
    vi.clearAllMocks();
  });

  it("round-trips the parked session and redirectTo", async () => {
    const authSession = makeSession();
    const cookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession, redirectTo: "/x/parts" }
    );

    const pending = await getPendingMfaSession(requestWithCookie(cookie));

    expect(pending?.authSession).toMatchObject({
      accessToken: "access-token",
      userId: "user_1"
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
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fails with no-session when nothing is parked or issued", async () => {
    const result = await completeMfaChallenge(
      new Request("http://localhost:3000/mfa", { method: "POST" }),
      "123456"
    );

    expect(result).toEqual({ success: false, reason: "no-session" });
  });

  it("mints an mfaVerified session from a pending challenge", async () => {
    vi.mocked(getTotpFactors).mockResolvedValue([
      {
        id: "factor_1",
        friendlyName: "Authenticator app",
        status: "verified",
        createdAt: "2026-08-01T00:00:00Z"
      }
    ]);
    vi.mocked(verifyTotpChallenge).mockResolvedValue({
      access_token: "aal2-access",
      refresh_token: "aal2-refresh",
      expires_at: FUTURE_EXPIRES_AT,
      user: { id: "user_1", email: "jane@example.com" }
    } as any);

    const pendingCookie = await setPendingMfaSession(
      new Request("http://localhost:3000/callback"),
      { authSession: makeSession(), redirectTo: "/x/parts" }
    );

    const result = await completeMfaChallenge(
      requestWithCookie(pendingCookie),
      "123456"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.authSession.accessToken).toBe("aal2-access");
      expect(result.authSession.mfaVerified).toBe(true);
      expect(result.redirectTo).toBe("/x/parts");
      // The cookie it returns holds the full session and no pending state.
      expect(
        await getPendingMfaSession(requestWithCookie(result.sessionCookie))
      ).toBeNull();
    }
  });

  it("falls back to the issued session when bounced by the re-check", async () => {
    vi.mocked(getTotpFactors).mockResolvedValue([
      {
        id: "factor_1",
        friendlyName: null,
        status: "verified",
        createdAt: "2026-08-01T00:00:00Z"
      }
    ]);
    vi.mocked(verifyTotpChallenge).mockResolvedValue({
      access_token: "aal2-access",
      refresh_token: "aal2-refresh",
      expires_at: FUTURE_EXPIRES_AT,
      user: { id: "user_1", email: "jane@example.com" }
    } as any);

    const staleCookie = await setAuthSession(
      new Request("http://localhost:3000/x"),
      { authSession: makeSession({ console: "company_1" }) }
    );

    const result = await completeMfaChallenge(
      requestWithCookie(staleCookie),
      "123456"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.authSession.mfaVerified).toBe(true);
      // Console mode survives the token rotation.
      expect(result.authSession.console).toBe("company_1");
    }
  });

  it("rejects a wrong code", async () => {
    vi.mocked(getTotpFactors).mockResolvedValue([
      {
        id: "factor_1",
        friendlyName: null,
        status: "verified",
        createdAt: "2026-08-01T00:00:00Z"
      }
    ]);
    vi.mocked(verifyTotpChallenge).mockResolvedValue(null);

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
});

describe("requireAuthSession MFA re-check", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("bounces an unverified session when the user has a factor", async () => {
    vi.mocked(userHasVerifiedTotpFactor).mockResolvedValue(true);

    const cookie = await setAuthSession(
      new Request("http://localhost:3000/x"),
      { authSession: makeSession() }
    );

    await expect(
      requireAuthSession(requestWithCookie(cookie))
    ).rejects.toSatisfy((response: any) => {
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toContain("/mfa");
      return true;
    });
  });

  it("passes an mfaVerified session without a factor lookup", async () => {
    const cookie = await setAuthSession(
      new Request("http://localhost:3000/x"),
      { authSession: makeSession({ mfaVerified: true }) }
    );

    const session = await requireAuthSession(requestWithCookie(cookie));

    expect(session.userId).toBe("user_1");
    expect(userHasVerifiedTotpFactor).not.toHaveBeenCalled();
  });

  it("passes an unverified session when the user has no factor", async () => {
    vi.mocked(userHasVerifiedTotpFactor).mockResolvedValue(false);

    const cookie = await setAuthSession(
      new Request("http://localhost:3000/x"),
      { authSession: makeSession() }
    );

    const session = await requireAuthSession(requestWithCookie(cookie));

    expect(session.userId).toBe("user_1");
  });
});
