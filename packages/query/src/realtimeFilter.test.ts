// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { matchesIdFilter } from "./realtimeFilter";

describe("matchesIdFilter", () => {
  it("matches every change without a filter", () => {
    expect(matchesIdFilter(undefined, ["a"])).toBe(true);
  });

  it("matches an id=eq filter only for that id", () => {
    expect(matchesIdFilter("id=eq.a", ["a", "b"])).toBe(true);
    expect(matchesIdFilter("id=eq.c", ["a", "b"])).toBe(false);
  });

  it("matches an id=in filter when any id is in it", () => {
    expect(matchesIdFilter("id=in.(a,b)", ["b"])).toBe(true);
    expect(matchesIdFilter("id=in.(a,b)", ["c"])).toBe(false);
  });

  it("matches every change for a filter on another column", () => {
    expect(matchesIdFilter("jobId=eq.j1", ["a"])).toBe(true);
  });

  it("matches a change that carries no ids", () => {
    expect(matchesIdFilter("id=eq.a", null)).toBe(true);
  });
});
