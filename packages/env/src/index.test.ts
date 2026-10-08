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

  it.each([
    ["carbon-git-x.vercel.app", "https://carbon-git-x.vercel.app"],
    ["https://preview.example.com", "https://preview.example.com"]
  ])("a preview URL from %s has one scheme", async (url, expected) => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", url);
    const env = await import("./index");
    expect(env.getAppUrl()).toBe(expected);
    expect(env.getMESUrl()).toBe(expected);
  });
});
