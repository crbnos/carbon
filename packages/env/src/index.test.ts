// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@carbon/utils");
  vi.resetModules();
});

describe("module load", () => {
  it("stops a server with one report of everything missing", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("REDIS_URL", "");
    await expect(import("./index")).rejects.toThrow(
      /Carbon can't start[\s\S]*REDIS_URL[\s\S]*SESSION_SECRET/
    );
  });

  it("never throws in the browser, and keeps secrets out", async () => {
    vi.doMock("@carbon/utils", async (original) => ({
      ...(await original<typeof import("@carbon/utils")>()),
      isBrowser: true
    }));
    vi.stubGlobal("window", {
      env: { VERCEL_URL: "https://erp.test", SESSION_SECRET: "leaked" }
    });
    const env = await import("./index");
    expect(env.APP_URL).toBe("https://erp.test");
    expect(env.SESSION_SECRET).toBe("");
    expect(env.SUPABASE_URL).toBeUndefined();
  });
});
