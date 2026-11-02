// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ edition: "enterprise" }));
vi.mock("@carbon/auth", () => ({
  get CarbonEdition() {
    return state.edition;
  }
}));
vi.mock("@carbon/env", () => ({
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_ANON_KEY: "anon-key"
}));

// The module caches the answer, so each test loads a fresh copy.
async function signupDisabled() {
  vi.resetModules();
  const { isPlatformSignupDisabled } = await import("./self-signup.server");
  return isPlatformSignupDisabled();
}

function settings(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isPlatformSignupDisabled", () => {
  it("follows the instance setting on Enterprise", async () => {
    state.edition = "enterprise";
    settings({ disable_signup: true });
    expect(await signupDisabled()).toBe(true);
    settings({ disable_signup: false });
    expect(await signupDisabled()).toBe(false);
  });

  it("treats sign-ups as off on Enterprise when the setting can't be read", async () => {
    state.edition = "enterprise";
    settings({ message: "upstream unavailable" }, 503);
    expect(await signupDisabled()).toBe(true);
    settings({ message: "no setting" });
    expect(await signupDisabled()).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );
    expect(await signupDisabled()).toBe(true);
  });

  it("keeps sign-ups allowed on Community when the setting can't be read", async () => {
    state.edition = "community";
    settings({ message: "upstream unavailable" }, 503);
    expect(await signupDisabled()).toBe(false);
  });
});
