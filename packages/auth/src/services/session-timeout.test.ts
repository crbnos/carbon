import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolation mocks — session.server's siblings pull in supabase/env at module
// load; stub them so the cookie/predicate logic under test runs against the
// real react-router session storage only. (Mirrors mfa-session.test.ts.)
vi.mock("@carbon/kv", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null)
  }
}));

const IDLE_MS = 15 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

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
  // refreshAccessToken returns a FRESH-minted-looking session (createdAt/lastActiveAt
  // = "now"), so the preserve test proves refreshAuthSession restores the originals.
  makeAuthSession: vi.fn(),
  refreshAccessToken: vi.fn(),
  verifyAuthSession: vi.fn().mockResolvedValue(true)
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
import { refreshAccessToken } from "./auth.server";
import {
  isSessionExpiredAbsolute,
  isSessionIdleLocked,
  refreshAuthSession,
  setAuthSession
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

const requestWithCookie = (
  cookie: string,
  { method = "POST", url = "http://localhost:3000/x" } = {}
) => new Request(url, { method, headers: { Cookie: cookie } });

describe("session timeout predicates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("isSessionExpiredAbsolute (3.1.11)", () => {
    it("is false when createdAt is missing (back-compat)", () => {
      expect(isSessionExpiredAbsolute(makeSession())).toBe(false);
    });

    it("is false within the 12h cap", () => {
      const session = makeSession({
        createdAt: Date.now() - (ABSOLUTE_MS - 1000)
      });
      expect(isSessionExpiredAbsolute(session)).toBe(false);
    });

    it("is true past the 12h cap", () => {
      const session = makeSession({
        createdAt: Date.now() - (ABSOLUTE_MS + 1000)
      });
      expect(isSessionExpiredAbsolute(session)).toBe(true);
    });
  });

  describe("isSessionIdleLocked (3.1.10)", () => {
    it("is false when lastActiveAt is missing (back-compat)", () => {
      expect(isSessionIdleLocked(makeSession())).toBe(false);
    });

    it("is false within the 15min idle window", () => {
      const session = makeSession({
        lastActiveAt: Date.now() - (IDLE_MS - 1000)
      });
      expect(isSessionIdleLocked(session)).toBe(false);
    });

    it("is true past the 15min idle window", () => {
      const session = makeSession({
        lastActiveAt: Date.now() - (IDLE_MS + 1000)
      });
      expect(isSessionIdleLocked(session)).toBe(true);
    });
  });
});

describe("refreshAuthSession preserves session-age clocks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps the original createdAt/lastActiveAt across a silent token refresh", async () => {
    // Session was created 8h ago and last active 2min ago.
    const originalCreatedAt = Date.now() - 8 * 60 * 60 * 1000;
    const originalLastActiveAt = Date.now() - 2 * 60 * 1000;

    const cookie = await setAuthSession(
      new Request("http://localhost:3000/x"),
      {
        authSession: makeSession({
          createdAt: originalCreatedAt,
          lastActiveAt: originalLastActiveAt
        })
      }
    );

    // The refresh rebuild looks freshly-minted (createdAt/lastActiveAt = now).
    vi.mocked(refreshAccessToken).mockResolvedValue(
      makeSession({ createdAt: Date.now(), lastActiveAt: Date.now() })
    );

    // POST so refreshAuthSession returns inline rather than throwing a GET redirect.
    const refreshed = await refreshAuthSession(requestWithCookie(cookie));

    // The absolute-cap clock and idle clock are the ORIGINALS, not "now".
    expect(refreshed.createdAt).toBe(originalCreatedAt);
    expect(refreshed.lastActiveAt).toBe(originalLastActiveAt);
    // Sanity: a session 8h old is not yet absolute-expired, and 2min idle is not locked.
    expect(isSessionExpiredAbsolute(refreshed)).toBe(false);
    expect(isSessionIdleLocked(refreshed)).toBe(false);
  });
});
