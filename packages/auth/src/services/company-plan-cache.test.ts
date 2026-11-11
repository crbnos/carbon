// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterAll, describe, expect, it, vi } from "vitest";

// Import-safety only: the module builds a Supabase client and a Redis
// connection at import.
vi.hoisted(() => {
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
});
vi.mock("@carbon/kv", () => ({ redis: {} }));

afterAll(() => vi.unstubAllEnvs());

import { planIdAfterRead, planIdFromCache } from "./company.server";

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

describe("planIdAfterRead", () => {
  it("takes the row's plan id on a successful read", () => {
    expect(planIdAfterRead({ planId: "BUSINESS" }, "STARTER")).toBe("BUSINESS");
    expect(planIdAfterRead({ planId: null }, "STARTER")).toBeNull();
  });

  // A failed read returned null, which downgraded a paying company to the
  // lowest plan until the next successful read.
  it("keeps the last good plan id when a read fails", () => {
    expect(planIdAfterRead({ error: new Error("down") }, "BUSINESS")).toBe(
      "BUSINESS"
    );
  });

  it("returns null when a read fails with nothing read before", () => {
    expect(planIdAfterRead({ error: new Error("down") }, undefined)).toBeNull();
  });
});
