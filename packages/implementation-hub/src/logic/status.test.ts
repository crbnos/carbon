// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  ONBOARDING_COUNT_KEYS,
  summarizeHubProgress,
  summarizeOnboardingCounts
} from "./status";

const ok = (count: number | null) => ({ count, error: null });

describe("summarizeOnboardingCounts", () => {
  it("keeps each count under its own key", () => {
    const { counts, unavailable } = summarizeOnboardingCounts({
      locations: ok(2),
      completedJobs: ok(1),
      ...Object.fromEntries(
        ONBOARDING_COUNT_KEYS.filter(
          (key) => key !== "locations" && key !== "completedJobs"
        ).map((key) => [key, ok(0)])
      )
    });
    expect(counts.locations).toBe(2);
    expect(counts.completedJobs).toBe(1);
    expect(unavailable).toEqual([]);
  });

  it("reads a missing count as zero", () => {
    const { counts } = summarizeOnboardingCounts(
      Object.fromEntries(ONBOARDING_COUNT_KEYS.map((key) => [key, ok(null)]))
    );
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it("reports a failed read as unavailable, never as zero", () => {
    const { counts, unavailable } = summarizeOnboardingCounts({
      ...Object.fromEntries(ONBOARDING_COUNT_KEYS.map((key) => [key, ok(3)])),
      suppliers: { count: null, error: { code: "42501" } }
    });
    expect(counts.suppliers).toBeNull();
    expect(counts.locations).toBe(3);
    expect(unavailable).toEqual(["suppliers"]);
  });

  it("reports counts that were never read as unavailable", () => {
    const { counts, unavailable } = summarizeOnboardingCounts({
      locations: ok(1)
    });
    expect(counts.locations).toBe(1);
    expect(counts.processes).toBeNull();
    expect(unavailable).toHaveLength(ONBOARDING_COUNT_KEYS.length - 1);
  });
});

describe("summarizeHubProgress", () => {
  it("counts finished steps and ticked checks", () => {
    expect(
      summarizeHubProgress([
        { kind: "gate", value: "done" },
        { kind: "task", value: "done" },
        { kind: "productStep", value: "prog" },
        { kind: "task", value: "blocked" },
        { kind: "task", value: "todo" },
        { kind: "check", value: "1" },
        { kind: "check", value: "0" }
      ])
    ).toEqual({ stepsDone: 3, stepsInProgress: 1, stepsBlocked: 1 });
  });

  it("does not count scope flags or format rows as finished steps", () => {
    expect(
      summarizeHubProgress([
        { kind: "scopeFlag", value: "1" },
        { kind: "scopeFlag", value: "1" },
        { kind: "fmt", value: "1" }
      ])
    ).toEqual({ stepsDone: 0, stepsInProgress: 0, stepsBlocked: 0 });
  });
});
