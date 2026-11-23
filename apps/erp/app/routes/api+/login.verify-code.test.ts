// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const lockouts = vi.hoisted(() => [] as unknown[]);
const ratelimits = vi.hoisted(() => [] as unknown[]);
const recordFailure = vi.hoisted(() => vi.fn());
const refund = vi.hoisted(() => vi.fn());
const verifyOtp = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({
  assertIsPost: () => undefined,
  error: (_e: unknown, message: string) => ({ success: false, message }),
  RATE_LIMIT: 5,
  signInCodeValidator: {}
}));
vi.mock("@carbon/auth/auth.server", () => ({ logAuthEvent: () => undefined }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ auth: { verifyOtp } })
}));
vi.mock("@carbon/form", () => ({
  validator: () => ({
    validate: async () => ({ data: { email: "a@x.com", code: "123456" } })
  })
}));
vi.mock("@carbon/kv", () => ({
  SIGN_IN_CODE_LOCKOUT_PREFIX: "@carbon/lockout-code",
  maxAttemptsForRateLimit: () => 5,
  redis: {},
  AccountLockout: class {
    constructor(options: unknown) {
      lockouts.push(options);
    }
    recordFailure = recordFailure;
    refund = refund;
  },
  Ratelimit: Object.assign(
    class {
      constructor(options: unknown) {
        ratelimits.push(options);
      }
      limit = async () => ({ success: true });
    },
    { slidingWindow: () => "window" }
  )
}));

import { action } from "./login.verify-code";

const post = async () => {
  const res = (await action({
    request: new Request("http://localhost/api/login/verify-code", {
      method: "POST",
      body: new FormData()
    })
  } as unknown as ActionFunctionArgs)) as
    | { data: { message?: string }; init: { status: number } }
    | { success: true };
  return "init" in res
    ? { status: res.init.status, message: res.data.message }
    : { status: 200, message: undefined };
};

describe("sign-in code", () => {
  beforeEach(() => {
    calls.length = 0;
    lockouts.length = 0;
    ratelimits.length = 0;
    recordFailure.mockReset().mockImplementation(async () => {
      calls.push("count");
      return { locked: false, retryAfterSeconds: 0 };
    });
    refund.mockReset();
    verifyOtp.mockReset().mockImplementation(async () => {
      calls.push("verify");
      return {
        data: { session: { refresh_token: "r", user: { id: "u" } } },
        error: null
      };
    });
  });

  it("keeps its own lockout and IP bucket, apart from the link's", async () => {
    await post();
    expect(lockouts).toEqual([
      expect.objectContaining({
        prefix: "@carbon/lockout-code",
        maxAttempts: 5
      })
    ]);
    expect(ratelimits).toEqual([
      expect.objectContaining({ prefix: "@carbon/ratelimit-code" })
    ]);
  });

  it("counts the attempt before checking the code", async () => {
    expect((await post()).status).toBe(200);
    expect(calls).toEqual(["count", "verify"]);
  });

  it("does not check a code once the guesses run out", async () => {
    recordFailure.mockResolvedValue({ locked: true, retryAfterSeconds: 60 });
    expect((await post()).status).toBe(429);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("calls a wrong code wrong, and keeps the attempt", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError(
        "Token has expired or is invalid",
        403,
        "otp_expired"
      )
    });
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.message).toMatch(/wrong/);
    expect(refund).not.toHaveBeenCalled();
  });

  it.each([
    ["Auth unreachable", new AuthRetryableFetchError("fetch failed", 0)],
    ["Auth failing", new AuthApiError("boom", 500, undefined)],
    ["Auth throttling", new AuthApiError("slow down", 429, undefined)]
  ])("%s: asks for a retry and gives the attempt back", async (_, err) => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: err });
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.message).not.toMatch(/wrong/);
    expect(refund).toHaveBeenCalledWith("a@x.com");
  });
});
