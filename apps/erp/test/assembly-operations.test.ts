// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldStartAssemblyPlan } from "../app/modules/production/production.models";

// Generating steps with no plan yet starts one, unless one is on its way.

const now = new Date("2026-10-20T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => vi.useRealTimers());

describe("shouldStartAssemblyPlan", () => {
  it.each(["Queued", "Processing"])(
    "waits for a model that is %s",
    (processingStatus) => {
      expect(shouldStartAssemblyPlan(processingStatus, null)).toBe(false);
    }
  );

  it("starts a plan for a converted model with no plan job", () => {
    expect(shouldStartAssemblyPlan("Success", null)).toBe(true);
  });

  it.each([
    ["Queued", 1],
    ["Processing", 30]
  ])("waits for a %s plan job started %i minutes ago", (status, minutes) => {
    expect(
      shouldStartAssemblyPlan("Success", {
        status,
        createdAt: minutesAgo(minutes)
      })
    ).toBe(false);
  });

  // A worker that died leaves its row behind; past the stale window it is not running.
  it.each([
    ["Queued", 3],
    ["Processing", 46],
    ["Failed", 1]
  ])("starts over a %s plan job started %i minutes ago", (status, minutes) => {
    expect(
      shouldStartAssemblyPlan("Success", {
        status,
        createdAt: minutesAgo(minutes)
      })
    ).toBe(true);
  });
});
