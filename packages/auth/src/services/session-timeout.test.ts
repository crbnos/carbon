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
  flash,
  getSessionFlash,
  isSessionExpiredAbsolute,
  isSessionIdleLocked,
  refreshAuthSession,
  requireAuthSession,
  setAuthSession
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

const IDLE_MS = 15 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

// GoTrue, answered over a stubbed fetch: a token refresh mints a fresh
// session, and the admin factor list says whether the user enrolled TOTP.
const gotrue = { hasVerifiedTotp: false };
const fakeGoTrue = async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" }
    });
  if (url.pathname === "/auth/v1/token") {
    return json({
      access_token: "fresh-access-token",
      refresh_token: "fresh-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: FUTURE_EXPIRES_AT,
      user: { id: USER_ID, email: "jane@example.com" }
    });
  }
  if (url.pathname === `/auth/v1/admin/users/${USER_ID}/factors`) {
    return json(
      gotrue.hasVerifiedTotp
        ? [{ id: "factor_1", factor_type: "totp", status: "verified" }]
        : []
    );
  }
  return new Response("{}", { status: 404 });
};

beforeEach(() => {
  kv.clear();
  gotrue.hasVerifiedTotp = false;
  vi.stubGlobal("fetch", fakeGoTrue);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => vi.unstubAllEnvs());

const FUTURE_EXPIRES_AT = 4102444800; // far enough that isExpiringSoon is false

const makeSession = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  accessToken: "access-token",
  refreshToken: "refresh-token",
  userId: USER_ID,
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

    // POST so refreshAuthSession returns inline rather than throwing a GET redirect.
    const refreshed = await refreshAuthSession(requestWithCookie(cookie));

    // The new tokens, but the absolute-cap and idle clocks are the ORIGINALS:
    // the rebuilt session would otherwise be stamped "now".
    expect(refreshed.accessToken).toBe("fresh-access-token");
    expect(refreshed.createdAt).toBe(originalCreatedAt);
    expect(refreshed.lastActiveAt).toBe(originalLastActiveAt);
    // Sanity: a session 8h old is not yet absolute-expired, and 2min idle is not locked.
    expect(isSessionExpiredAbsolute(refreshed)).toBe(false);
    expect(isSessionIdleLocked(refreshed)).toBe(false);
  });
});

// A request that has to leave for a token refresh, login or MFA challenge must
// come back to the URL it asked for, query string included. A notification
// email links to `/api/link?event=…&documentId=…`, and returning to the bare
// path lands on the home page.
describe("requireAuthSession returns to the requested URL", () => {
  const EMAIL_LINK =
    "/api/link?event=approval-requested&documentId=po_1&companyId=co_1&documentType=purchaseOrder";
  const ORIGIN = "http://localhost:3000";

  const redirectOf = async (request: Request) => {
    try {
      await requireAuthSession(request);
    } catch (thrown) {
      return thrown as Response;
    }
    throw new Error("requireAuthSession did not redirect");
  };

  const redirectToOf = (response: Response) =>
    new URL(response.headers.get("Location") ?? "", ORIGIN).searchParams.get(
      "redirectTo"
    );

  const sessionCookie = async (overrides: Partial<AuthSession> = {}) =>
    setAuthSession(new Request(`${ORIGIN}/x`), {
      authSession: makeSession(overrides)
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("after a token refresh", async () => {
    // Thirty seconds left, inside the refresh threshold.
    const cookie = await sessionCookie({
      expiresAt: Math.floor(Date.now() / 1000) + 30
    });
    const response = await redirectOf(
      requestWithCookie(cookie, {
        method: "GET",
        url: `${ORIGIN}${EMAIL_LINK}`
      })
    );

    expect(response.headers.get("Location")).toBe(EMAIL_LINK);
    expect(response.headers.get("Set-Cookie")).toContain("carbon=");
  });

  it("after a login, when there is no session", async () => {
    const response = await redirectOf(new Request(`${ORIGIN}${EMAIL_LINK}`));

    expect(response.headers.get("Location")).toMatch(/^\/login\?/);
    expect(redirectToOf(response)).toBe(EMAIL_LINK);
  });

  it("after an MFA challenge", async () => {
    const cookie = await sessionCookie();
    gotrue.hasVerifiedTotp = true;

    const response = await redirectOf(
      requestWithCookie(cookie, {
        method: "GET",
        url: `${ORIGIN}${EMAIL_LINK}`
      })
    );

    expect(response.headers.get("Location")).toMatch(/^\/mfa\?/);
    expect(redirectToOf(response)).toBe(EMAIL_LINK);
  });
});

describe("a flash keeps the signed-in session's expiry", () => {
  // The toast is stored in the session cookie, so writing or reading it
  // re-issues that cookie. Without a max age it became a cookie that ends
  // when the browser closes, signing the user out.
  // A Set-Cookie header as the browser would send it back.
  const cookiePair = (setCookie: string) => setCookie.split(";")[0] ?? "";
  const signedIn = async () =>
    cookiePair(
      await setAuthSession(new Request("http://localhost:3000/x"), {
        authSession: makeSession()
      })
    );

  it("when the flash is written", async () => {
    const { headers } = await flash(requestWithCookie(await signedIn()), {
      success: true,
      message: "Saved"
    });

    expect(headers["Set-Cookie"]).toContain("Max-Age=604800");
  });

  it("when the flash is read", async () => {
    const written = await flash(requestWithCookie(await signedIn()), {
      success: true,
      message: "Saved"
    });
    const read = await getSessionFlash(
      requestWithCookie(cookiePair(written.headers["Set-Cookie"]))
    );

    expect(read?.headers["Set-Cookie"]).toContain("Max-Age=604800");
  });
});
