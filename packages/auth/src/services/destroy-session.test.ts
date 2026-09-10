import { afterEach, describe, expect, it, vi } from "vitest";

// ── Isolation mocks ───────────────────────────────────────────────────────
// Mirrors session-timeout.test.ts: stub session.server's siblings so the
// cookie logic runs against the real react-router session storage only.
vi.mock("@carbon/kv", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null)
  }
}));

const signOutMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ error: null })
);

vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({
    auth: { admin: { signOut: signOutMock } }
  }))
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
  logAuthEvent: vi.fn(),
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
import { destroyAuthSession, setAuthSession } from "./session.server";

const makeSession = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  accessToken: "access-token-abc",
  refreshToken: "refresh-token",
  userId: "user_1",
  companyId: "company_1",
  companyGroupId: "group_1",
  email: "jane@example.com",
  expiresIn: 3000,
  expiresAt: 4102444800,
  ...overrides
});

const requestWithCookie = (cookie: string) =>
  new Request("http://localhost:3000/logout", {
    method: "POST",
    headers: { Cookie: cookie }
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe("destroyAuthSession GoTrue revocation", () => {
  it("revokes the session server-side when the caller opts in", async () => {
    const cookie = await setAuthSession(
      new Request("http://localhost:3000/callback", { method: "POST" }),
      { authSession: makeSession() }
    );

    const response = await destroyAuthSession(requestWithCookie(cookie), {
      revoke: true
    });

    expect(signOutMock).toHaveBeenCalledWith("access-token-abc", "local");
    expect(response.status).toBe(302);
  });

  it("does NOT revoke by default — recoverable error paths clear cookies only", async () => {
    const cookie = await setAuthSession(
      new Request("http://localhost:3000/callback", { method: "POST" }),
      { authSession: makeSession() }
    );

    const response = await destroyAuthSession(requestWithCookie(cookie));

    expect(signOutMock).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
  });

  it("still logs out when revocation fails (already-invalid token, GoTrue down)", async () => {
    signOutMock.mockRejectedValueOnce(new Error("gotrue unreachable"));
    const cookie = await setAuthSession(
      new Request("http://localhost:3000/callback", { method: "POST" }),
      { authSession: makeSession() }
    );

    const response = await destroyAuthSession(requestWithCookie(cookie), {
      revoke: true
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/");
  });

  it("skips revocation when there is no session cookie", async () => {
    const response = await destroyAuthSession(
      new Request("http://localhost:3000/logout", { method: "POST" }),
      { revoke: true }
    );

    expect(signOutMock).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
  });
});
