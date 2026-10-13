// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// Import-safety only: the module reads env and builds clients at import time.
vi.mock("@carbon/auth", () => ({
  CarbonEdition: "cloud",
  DOMAIN: "localhost"
}));
vi.mock("@carbon/kv", () => ({ redis: {} }));
vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

import { planIdFromCache } from "./company.server";

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
