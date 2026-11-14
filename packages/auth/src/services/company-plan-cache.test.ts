// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Import-safety only: the module builds a Supabase client and a Redis
// connection at import.
vi.hoisted(() => {
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});
// An empty cache: every plan read goes to the database.
vi.mock("@carbon/kv", () => ({
  redis: { get: async () => null, set: async () => "OK" }
}));

afterAll(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllGlobals());

import {
  getCompanyPlanId,
  getCompanyPlanIdOrThrow,
  planIdFromCache
} from "./company.server";

// The database answers every request with an error.
function failingDatabase() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: "XX000", message: "database unavailable" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
    )
  );
}

describe("planIdFromCache", () => {
  it("returns a cached plan id", () => {
    expect(planIdFromCache("PARTNER-300")).toBe("PARTNER-300");
  });

  // Companies with no plan row were re-read from the database on every request.
  it("treats an empty string as a cached missing row, not a miss", () => {
    expect(planIdFromCache("")).toBeNull();
  });

  it("treats an unset key, or Redis being down, as a miss", () => {
    expect(planIdFromCache(null)).toBeUndefined();
  });
});

describe("a failed plan read", () => {
  it("reads as no plan for the lenient lookup", async () => {
    failingDatabase();
    await expect(getCompanyPlanId("company-1")).resolves.toBeNull();
  });

  // A check that must fail closed would otherwise read the failure as the
  // lowest plan and turn the company's rules off.
  it("throws for the lookup that must fail closed", async () => {
    failingDatabase();
    await expect(getCompanyPlanIdOrThrow("company-1")).rejects.toThrow(
      "Failed to read company plan"
    );
  });
});
