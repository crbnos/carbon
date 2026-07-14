import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Redis-down simulation ─────────────────────────────────────────────────
// PR #1083 wraps the @carbon/kv client in withResilience(): reads/writes resolve
// `null` instead of throwing when Redis is unreachable. These tests prove the
// auth path stays safe under that condition — every hardened function either
// falls through to a safe path or fails closed, and none throw / reject.
vi.mock("@carbon/kv", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null)
  }
}));

// Env is validated at import time (getEnv throws on missing required vars), so we
// stub the config module rather than requiring a full environment in the test run.
vi.mock("../config/env", () => ({
  RESEND_DOMAIN: "test.dev",
  DOMAIN: "localhost",
  ERP_URL: "http://localhost:3000",
  MES_URL: "http://localhost:3001",
  VERCEL_URL: "",
  CarbonEdition: "Community",
  REFRESH_ACCESS_TOKEN_THRESHOLD: 60,
  SESSION_KEY: "auth",
  SESSION_MAX_AGE: 60 * 60 * 24 * 7,
  SESSION_SECRET: "test-session-secret"
}));

// Heavy / side-effectful dependencies of the modules under test.
vi.mock("@carbon/lib/resend.server", () => ({
  sendEmail: vi.fn().mockResolvedValue({ error: null })
}));
vi.mock("@carbon/documents/email", () => ({
  VerificationEmail: vi.fn(() => null)
}));
vi.mock("@react-email/components", () => ({
  render: vi.fn().mockResolvedValue("<html>code</html>")
}));
vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn()
}));
vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({}))
}));
// ./users backs both users.server (getClaims/makePermissionsFromClaims) and
// session.server (getPermissionCacheKey). getClaims returns a healthy DB result so
// getUserClaims can prove the Redis-miss → DB fallback path.
vi.mock("./users", () => ({
  getClaims: vi.fn().mockResolvedValue({ data: [{}], error: null }),
  getPermissionCacheKey: (userId: string) => `permissions:${userId}`,
  makePermissionsFromClaims: vi.fn(() => ({
    permissions: { parts: { view: [], create: [], update: [], delete: [] } },
    role: "employee"
  }))
}));
// session.server imports these siblings; they pull in supabase/env so we stub them.
vi.mock("./auth.server", () => ({
  refreshAccessToken: vi.fn(),
  verifyAuthSession: vi.fn()
}));
vi.mock("./company.server", () => ({
  setCompanyId: vi.fn(() => "companyId=cookie")
}));

import { redis } from "@carbon/kv";
import { sendEmail } from "@carbon/lib/resend.server";
import type { AuthSession } from "../types";
import {
  getAndDeleteAuthChallenge,
  getAndDeleteRegistrationChallenge
} from "./passkey.server";
import { setAuthSession, updateCompanySession } from "./session.server";
import { getUserClaims } from "./users.server";
import { sendVerificationCode, verifyEmailCode } from "./verification.server";

beforeEach(() => {
  // clearAllMocks resets call history but keeps the "Redis down" (→ null)
  // implementations declared in the vi.mock factory above.
  vi.clearAllMocks();
});

describe("auth Redis-down resilience", () => {
  it("[case 1] getUserClaims falls through to the DB when redis.get is null", async () => {
    const claims = await getUserClaims("user-1", "company-1");

    // Cache miss (Redis down) → DB lookup → correct claims, no throw.
    expect(redis.get).toHaveBeenCalledWith("permissions:user-1");
    expect(claims).toMatchObject({ role: "employee" });
    // Best-effort cache write was attempted but its null return didn't abort.
    expect(redis.set).toHaveBeenCalled();
  });

  it("[case 2] sendVerificationCode returns false without throwing when redis.set fails", async () => {
    // A genuine Redis failure that escapes fail-soft (e.g. a throw) is caught and
    // reported as an unsendable code rather than crashing the request.
    vi.mocked(redis.set).mockRejectedValueOnce(new Error("redis down"));

    await expect(sendVerificationCode("user@example.com")).resolves.toBe(false);
  });

  it("[case 2b] sendVerificationCode fails closed (returns false, no email) when redis.set resolves null", async () => {
    // Under withResilience, a Redis-down `set` resolves null (not a throw). The code
    // must NOT send an unverifiable email in that case — it returns false without
    // ever calling sendEmail.
    await expect(sendVerificationCode("user@example.com")).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("[case 3] verifyEmailCode returns false (fail-closed) when redis.get is null", async () => {
    await expect(verifyEmailCode("user@example.com", "123456")).resolves.toBe(
      false
    );
  });

  it("[case 4] getAndDeleteRegistrationChallenge returns null when redis.getdel is null", async () => {
    await expect(
      getAndDeleteRegistrationChallenge("user-1")
    ).resolves.toBeNull();
  });

  it("[case 5] getAndDeleteAuthChallenge returns null when redis.getdel is null", async () => {
    await expect(getAndDeleteAuthChallenge("challenge-1")).resolves.toBeNull();
  });

  it("[case 6] updateCompanySession still returns a session cookie when redis.del is null", async () => {
    const authSession: AuthSession = {
      accessToken: "access",
      refreshToken: "refresh",
      userId: "user-1",
      companyId: "old-company",
      companyGroupId: "old-group",
      email: "user@example.com",
      expiresIn: 3600,
      expiresAt: 9_999_999_999
    };

    // Mint a real signed cookie via the module's own storage, then feed it back.
    const setCookie = await setAuthSession(new Request("http://localhost/"), {
      authSession
    });
    const cookiePair = setCookie.split(";")[0] ?? "";
    const request = new Request("http://localhost/", {
      headers: { Cookie: cookiePair }
    });

    const cookie = await updateCompanySession(
      request,
      "new-company",
      "new-group"
    );

    // Cache invalidation was attempted (fire-and-forget) and the null return was benign.
    expect(redis.del).toHaveBeenCalledWith("permissions:user-1");
    expect(typeof cookie).toBe("string");
    expect(cookie.length).toBeGreaterThan(0);
  });
});
