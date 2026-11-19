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

// The first import transforms @carbon/utils cold. On a CI runner that alone
// takes 5-6 s, past the default 5 s timeout, whichever test happens to run first.
describe("module load", { timeout: 30_000 }, () => {
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

describe("publicSupabaseUrl", { timeout: 30_000 }, () => {
  const signed =
    "http://storage-gateway:8000/storage/v1/object/upload/sign/co/a.pdf?token=t";

  it("moves a link the server signed in-cluster onto the public address", async () => {
    vi.stubEnv("SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://storage-gateway:8000");
    const env = await import("./index");
    expect(env.publicSupabaseUrl(signed)).toBe(
      "https://api.example.com/storage/v1/object/upload/sign/co/a.pdf?token=t"
    );
  });

  it("leaves the link alone when no internal address is set", async () => {
    vi.stubEnv("SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "");
    const env = await import("./index");
    const link =
      "https://api.example.com/storage/v1/object/sign/co/a.pdf?token=t";
    expect(env.publicSupabaseUrl(link)).toBe(link);
  });
});

describe("rebaseUrl", { timeout: 30_000 }, () => {
  it.each([
    [
      "a base given with a trailing slash",
      "http://gw:8000/storage/v1/object/sign/a.pdf?token=t&download=A%2BB.pdf",
      "http://gw:8000/",
      "https://api.example.com",
      "https://api.example.com/storage/v1/object/sign/a.pdf?token=t&download=A%2BB.pdf"
    ],
    [
      "a public address behind a path",
      "http://gw:8000/storage/v1/object/sign/a.pdf?token=t",
      "http://gw:8000",
      "https://example.com/supabase/",
      "https://example.com/supabase/storage/v1/object/sign/a.pdf?token=t"
    ],
    [
      "a link on another host",
      "https://elsewhere.test/storage/v1/object/sign/a.pdf",
      "http://gw:8000",
      "https://api.example.com",
      "https://elsewhere.test/storage/v1/object/sign/a.pdf"
    ],
    [
      "a link outside the base's path",
      "http://gw:8000/supabase-other/a.pdf",
      "http://gw:8000/supabase",
      "https://api.example.com",
      "http://gw:8000/supabase-other/a.pdf"
    ]
  ])("handles %s", async (_, url, from, to, expected) => {
    const { rebaseUrl } = await import("./index");
    expect(rebaseUrl(url, from, to)).toBe(expected);
  });
});
