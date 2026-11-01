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
  getAuthSession,
  setAuthSession,
  updateCompanySession
} from "./session.server";
import { getUserClaims } from "./users.server";
import { sendVerificationCode, verifyEmailCode } from "./verification.server";

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

// Redis is down: @carbon/kv's withResilience() resolves every call to null
// instead of throwing.
const redisDown = vi.hoisted(() => ({
  get: async () => null,
  set: async (): Promise<string | null> => null,
  del: async () => null
}));
vi.mock("@carbon/kv", () => ({ redis: redisDown }));

// Outbound mail is a network boundary.
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("@carbon/lib/email.server", () => ({ sendEmail }));

// The database answers get_claims for a plain employee.
const fakeDatabase = async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname !== "/rest/v1/rpc/get_claims") {
    return new Response("{}", { status: 404 });
  }
  return new Response(
    JSON.stringify({ role: "employee", parts_view: ["company-1"] }),
    { headers: { "Content-Type": "application/json" } }
  );
};

beforeEach(() => {
  sendEmail.mockReset();
  vi.stubGlobal("fetch", fakeDatabase);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => vi.unstubAllEnvs());

// Every auth path that touches Redis either falls through to a safe path or
// fails closed when Redis is down; none throws.
describe("auth with Redis down", () => {
  it("reads claims from the database when the permission cache is unreachable", async () => {
    await expect(getUserClaims("user-1", "company-1")).resolves.toEqual({
      role: "employee",
      permissions: {
        parts: { view: ["company-1"], create: [], update: [], delete: [] }
      }
    });
  });

  it("does not send a verification email it could not store the code for", async () => {
    await expect(sendVerificationCode("user@example.com")).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports a verification code as unsendable when the store throws", async () => {
    vi.spyOn(redisDown, "set").mockRejectedValueOnce(new Error("redis down"));

    await expect(sendVerificationCode("user@example.com")).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a verification code it cannot look up", async () => {
    await expect(verifyEmailCode("user@example.com", "123456")).resolves.toBe(
      false
    );
  });

  it("still switches the session's company when the cache bust fails", async () => {
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
    const cookieOf = (setCookie: string) =>
      new Request("http://localhost/", {
        headers: { Cookie: setCookie.split(";")[0] ?? "" }
      });

    const signedIn = await setAuthSession(new Request("http://localhost/"), {
      authSession
    });
    const switched = await updateCompanySession(
      cookieOf(signedIn),
      "new-company",
      "new-group"
    );

    expect(await getAuthSession(cookieOf(switched))).toEqual({
      ...authSession,
      companyId: "new-company",
      companyGroupId: "new-group"
    });
  });
});
