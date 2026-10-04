// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { matchesFilter } from "./realtimeFilter";

describe("matchesFilter", () => {
  it("matches every change without a filter", () => {
    expect(matchesFilter(undefined, { ids: ["a"] })).toBe(true);
  });

  it("matches an id=eq filter only for that id", () => {
    expect(matchesFilter("id=eq.a", { ids: ["a", "b"] })).toBe(true);
    expect(matchesFilter("id=eq.c", { ids: ["a", "b"] })).toBe(false);
  });

  it("matches an id=in filter when any id is in it", () => {
    expect(matchesFilter("id=in.(a,b)", { ids: ["b"] })).toBe(true);
    expect(matchesFilter("id=in.(a,b)", { ids: ["c"] })).toBe(false);
  });

  it("matches a filter on a parent column by the parents the change names", () => {
    const change = { ids: ["a"], parents: { jobId: ["j1"] } };
    expect(matchesFilter("jobId=eq.j1", change)).toBe(true);
    expect(matchesFilter("jobId=eq.j2", change)).toBe(false);
    expect(matchesFilter("jobId=in.(j2,j1)", change)).toBe(true);
  });

  it("matches every change when the change does not name that column", () => {
    expect(matchesFilter("jobId=eq.j1", { ids: ["a"] })).toBe(true);
    expect(matchesFilter("jobId=eq.j1", { ids: ["a"], parents: {} })).toBe(
      true
    );
    expect(matchesFilter("status=eq.Done", { ids: ["a"] })).toBe(true);
  });

  it("matches a bulk change, which carries neither ids nor parents", () => {
    expect(matchesFilter("id=eq.a", { ids: null, parents: null })).toBe(true);
    expect(matchesFilter("jobId=eq.j1", { ids: null, parents: null })).toBe(
      true
    );
  });
});
