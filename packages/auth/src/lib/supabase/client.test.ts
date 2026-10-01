// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";

// Env is validated at import time (getEnv throws on missing required vars), so we
// stub the config module rather than requiring a full environment in the test run.
vi.mock("../../config/env", () => ({
  SUPABASE_ANON_KEY: "sb_publishable_anon",
  SUPABASE_INTERNAL_URL: "http://supabase.internal.test",
  SUPABASE_URL: "http://supabase.test"
}));

const { getCarbonAPIKeyClient, getCarbonClient } = await import("./client");

// Edge functions recognise a service-role caller by the Authorization bearer.
// supabase-js stops sending a new-format key as that bearer on function calls,
// so the client must set it itself for either key format.
describe("Edge Function calls carry the Authorization bearer", () => {
  const sent = () => {
    const [input, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers
    );
    return headers.get("Authorization");
  };

  const stubFetch = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["a legacy JWT key", "eyJhbGciOiJIUzI1NiJ9.e30.signature"],
    ["a new-format secret key", "sb_secret_abc123"]
  ])("service-role client with %s", async (_, key) => {
    stubFetch();
    await getCarbonClient(key).functions.invoke("create", { body: {} });
    expect(sent()).toBe(`Bearer ${key}`);
  });

  it("a user's token wins over the key", async () => {
    stubFetch();
    await getCarbonClient("sb_secret_abc123", "user-jwt").functions.invoke(
      "create",
      { body: {} }
    );
    expect(sent()).toBe("Bearer user-jwt");
  });

  it("API-key client", async () => {
    stubFetch();
    await getCarbonAPIKeyClient("crbn_key").functions.invoke("create", {
      body: {}
    });
    expect(sent()).toBe("Bearer sb_publishable_anon");
  });
});
