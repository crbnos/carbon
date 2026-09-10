import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveLoginMethod,
  getSessionId,
  recordLogin
} from "./login-history.server";

const mocks = vi.hoisted(() => {
  const insert = vi.fn();
  const lt = vi.fn();
  const eq = vi.fn(() => ({ lt }));
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ insert, delete: del }));
  const getCarbonServiceRole = vi.fn(() => ({ from }));
  return { insert, lt, eq, del, from, getCarbonServiceRole };
});

vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: mocks.getCarbonServiceRole
}));

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

function makeToken(payload: object): string {
  const segment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${segment}.signature`;
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://erp.example.com/callback", {
    method: "POST",
    headers
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue({ error: null });
  mocks.lt.mockResolvedValue({ error: null });
  mocks.getCarbonServiceRole.mockReturnValue({ from: mocks.from } as any);
});

const TOKEN = makeToken({
  session_id: "session-uuid-1",
  amr: [{ method: "otp", timestamp: 100 }]
});

describe("getSessionId", () => {
  it("returns the session_id claim", () => {
    expect(getSessionId(TOKEN)).toBe("session-uuid-1");
  });

  it("returns null for malformed tokens or a missing claim", () => {
    expect(getSessionId("not-a-jwt")).toBeNull();
    expect(getSessionId(makeToken({}))).toBeNull();
    expect(getSessionId(makeToken({ session_id: "" }))).toBeNull();
  });
});

describe("deriveLoginMethod", () => {
  it("maps the otp amr method to magic_link", () => {
    expect(
      deriveLoginMethod(makeToken({ amr: [{ method: "otp", timestamp: 100 }] }))
    ).toBe("magic_link");
  });

  it("uses the MOST RECENT amr entry, not the first", () => {
    expect(
      deriveLoginMethod(
        makeToken({
          amr: [
            { method: "otp", timestamp: 100 },
            { method: "oauth", timestamp: 200 }
          ],
          app_metadata: { provider: "google", providers: ["google"] }
        })
      )
    ).toBe("oauth_google");
  });

  it("resolves the oauth provider from app_metadata.providers", () => {
    expect(
      deriveLoginMethod(
        makeToken({
          amr: [{ method: "oauth", timestamp: 100 }],
          app_metadata: { provider: "email", providers: ["email", "azure"] }
        })
      )
    ).toBe("oauth_azure");
  });

  it("falls back to unknown for ambiguous oauth providers", () => {
    expect(
      deriveLoginMethod(
        makeToken({
          amr: [{ method: "oauth", timestamp: 100 }],
          app_metadata: { provider: "email", providers: ["google", "azure"] }
        })
      )
    ).toBe("unknown");
  });

  it("falls back to unknown for malformed tokens", () => {
    expect(deriveLoginMethod("not-a-jwt")).toBe("unknown");
    expect(deriveLoginMethod("a.!!!not-base64!!!.c")).toBe("unknown");
    expect(deriveLoginMethod(makeToken({}))).toBe("unknown");
  });
});

describe("recordLogin", () => {
  it("inserts a row with IP, decoded geo, and user agent from headers", async () => {
    await recordLogin({
      request: makeRequest({
        // Rightmost hop wins: the leftmost is client-supplied.
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        "x-vercel-ip-city": "S%C3%A3o%20Paulo",
        "x-vercel-ip-country": "BR",
        "user-agent": "Mozilla/5.0 test"
      }),
      userId: "user_1",
      email: "jane@example.com",
      accessToken: TOKEN,
      method: "magic_link",
      app: "erp"
    });

    expect(mocks.from).toHaveBeenCalledWith("userLogin");
    expect(mocks.insert).toHaveBeenCalledWith({
      userId: "user_1",
      sessionId: "session-uuid-1",
      method: "magic_link",
      app: "erp",
      ipAddress: "10.0.0.1",
      city: "São Paulo",
      country: "BR",
      userAgent: "Mozilla/5.0 test"
    });
  });

  it("normalizes IPv4-mapped IPv6 addresses from local proxies", async () => {
    await recordLogin({
      request: makeRequest({ "x-forwarded-for": "::ffff:127.0.0.1" }),
      userId: "user_1",
      email: "jane@example.com",
      accessToken: TOKEN,
      method: "oauth_google",
      app: "erp"
    });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: "127.0.0.1" })
    );
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    await recordLogin({
      request: makeRequest({ "x-real-ip": "203.0.113.7" }),
      userId: "user_1",
      email: "jane@example.com",
      accessToken: TOKEN,
      method: "magic_link",
      app: "erp"
    });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: "203.0.113.7" })
    );
  });

  it("stores nulls when headers are absent (self-hosted, no Vercel geo)", async () => {
    await recordLogin({
      request: makeRequest({}),
      userId: "user_1",
      email: "jane@example.com",
      accessToken: TOKEN,
      method: "passkey",
      app: "mes"
    });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: null,
        city: null,
        country: null,
        userAgent: null
      })
    );
  });

  it("prunes the user's rows older than the retention window", async () => {
    await recordLogin({
      request: makeRequest({}),
      userId: "user_1",
      email: "jane@example.com",
      accessToken: TOKEN,
      method: "magic_link",
      app: "erp"
    });

    expect(mocks.eq).toHaveBeenCalledWith("userId", "user_1");
    const pruneCall = mocks.lt.mock.calls[0]!;
    const [column, cutoff] = pruneCall as [string, string];
    expect(column).toBe("createdAt");
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(Date.now() - Date.parse(cutoff)).toBeGreaterThan(
      ninetyDaysMs - 60_000
    );
    expect(Date.now() - Date.parse(cutoff)).toBeLessThan(ninetyDaysMs + 60_000);
  });

  it("never throws when the insert fails", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "boom" } });
    await expect(
      recordLogin({
        request: makeRequest({}),
        userId: "user_1",
        email: "jane@example.com",
        accessToken: TOKEN,
        method: "magic_link",
        app: "erp"
      })
    ).resolves.toBeUndefined();
  });

  it("never throws when the insert rejects outright", async () => {
    mocks.insert.mockRejectedValue(new Error("connection refused"));
    await expect(
      recordLogin({
        request: makeRequest({}),
        userId: "user_1",
        email: "jane@example.com",
        accessToken: TOKEN,
        method: "magic_link",
        app: "erp"
      })
    ).resolves.toBeUndefined();
  });

  it("never throws when the service role client cannot be constructed", async () => {
    mocks.getCarbonServiceRole.mockImplementation(() => {
      throw new Error("missing env");
    });
    await expect(
      recordLogin({
        request: makeRequest({}),
        userId: "user_1",
        email: "jane@example.com",
        accessToken: TOKEN,
        method: "magic_link",
        app: "erp"
      })
    ).resolves.toBeUndefined();
  });
});
