import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveLoginMethod,
  getSessionId,
  recordLogin
} from "./login-history.server";

const mocks = vi.hoisted(() => {
  const insert = vi.fn();
  // The retention prune is one RPC so it cannot drop a device's anchor row.
  const rpc = vi.fn().mockResolvedValue({ error: null });
  // The device-novelty probe: an existence check, not a count —
  // .select(id).eq(userId).eq(deviceId).eq(mfaPending).limit(1).maybeSingle()
  const maybeSingle = vi.fn().mockResolvedValue({ data: null });
  const limit = vi.fn(() => ({ maybeSingle }));
  const seenEq3 = vi.fn(() => ({ limit }));
  const seenEq2 = vi.fn(() => ({ eq: seenEq3 }));
  const seenEq1 = vi.fn(() => ({ eq: seenEq2 }));
  const select = vi.fn(() => ({ eq: seenEq1 }));
  const from = vi.fn(() => ({ insert, select }));
  const getCarbonServiceRole = vi.fn(() => ({ from, rpc }));
  return {
    insert,
    rpc,
    select,
    seenEq1,
    seenEq2,
    seenEq3,
    maybeSingle,
    from,
    getCarbonServiceRole
  };
});

vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: mocks.getCarbonServiceRole
}));

// device.server imports ../config/env, which validates EVERY required var at
// module load — stub it so this suite does not depend on unrelated config.
vi.mock("../config/env", () => ({
  DOMAIN: "localhost",
  CarbonEdition: "Community",
  SESSION_SECRET: "test-session-secret"
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
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.maybeSingle.mockResolvedValue({ data: null });
  mocks.getCarbonServiceRole.mockReturnValue({
    from: mocks.from,
    rpc: mocks.rpc
  } as any);
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
      userAgent: "Mozilla/5.0 test",
      deviceId: null,
      mfaPending: false
    });
  });

  it("reports a device as new when it has no prior rows", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null });
    await expect(
      recordLogin({
        request: makeRequest({}),
        userId: "user_1",
        email: "u@example.com",
        accessToken: TOKEN,
        method: "magic_link",
        app: "erp",
        deviceId: "device-1"
      })
    ).resolves.toEqual({ isNewDevice: true });
  });

  it("reports a device as known when prior rows exist", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: "prior_row" } });
    await expect(
      recordLogin({
        request: makeRequest({}),
        userId: "user_1",
        email: "u@example.com",
        accessToken: TOKEN,
        method: "magic_link",
        app: "erp",
        deviceId: "device-1"
      })
    ).resolves.toEqual({ isNewDevice: false });
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

    // Via RPC, not a bare delete: the SQL function keeps each device's earliest
    // row so the revoke gate's "first seen" cannot be pruned forward.
    expect(mocks.rpc).toHaveBeenCalledWith(
      "prune_user_login_history",
      expect.objectContaining({ p_user_id: "user_1" })
    );
    const { p_cutoff: cutoff } = mocks.rpc.mock.calls[0]![1] as {
      p_cutoff: string;
    };
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(Date.now() - Date.parse(cutoff)).toBeGreaterThan(
      ninetyDaysMs - 60_000
    );
    expect(Date.now() - Date.parse(cutoff)).toBeLessThan(ninetyDaysMs + 60_000);
  });

  it("marks the row pending when a TOTP challenge still stands", async () => {
    await recordLogin({
      request: makeRequest({}),
      userId: "user_1",
      email: "jane@example.com",
      accessToken: TOKEN,
      method: "magic_link",
      app: "erp",
      deviceId: "device_1",
      mfaPending: true
    });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ mfaPending: true })
    );
  });

  it("ignores pending rows when deciding whether a device is new", async () => {
    // A login that never cleared MFA must not make the device look seen, or the
    // alert for the sign-in that DID succeed would be suppressed.
    await recordLogin({
      request: makeRequest({}),
      userId: "user_1",
      email: "jane@example.com",
      accessToken: TOKEN,
      method: "magic_link",
      app: "erp",
      deviceId: "device_1"
    });

    expect(mocks.select).toHaveBeenCalledWith("id");
    expect(mocks.seenEq1).toHaveBeenCalledWith("userId", "user_1");
    expect(mocks.seenEq2).toHaveBeenCalledWith("deviceId", "device_1");
    expect(mocks.seenEq3).toHaveBeenCalledWith("mfaPending", false);
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
    ).resolves.toEqual({ isNewDevice: false });
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
    ).resolves.toEqual({ isNewDevice: false });
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
    ).resolves.toEqual({ isNewDevice: false });
  });
});
