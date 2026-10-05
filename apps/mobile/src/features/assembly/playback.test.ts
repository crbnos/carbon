// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Motion } from "@carbon/viewer/types";
import { describe, expect, it } from "vitest";
import {
  formatClock,
  indexAtFraction,
  indexAtTime,
  STEP_DWELL_MS,
  stepHoldMs,
  stepProgress,
  timeline
} from "./playback";

describe("stepHoldMs", () => {
  it("holds a step that does not move for the dwell alone", () => {
    // Every step of every demo assembly is `none`. If this returned 0 the
    // player would run the whole build in one frame.
    expect(stepHoldMs({ type: "none" })).toBe(STEP_DWELL_MS);
  });

  it("adds the dwell to an insertion", () => {
    const motion: Motion = {
      type: "linear",
      direction: [0, 1, 0],
      distance: 220
    };
    expect(stepHoldMs(motion)).toBeGreaterThan(STEP_DWELL_MS);
  });
});

describe("timeline", () => {
  it("starts the first step at zero and stacks the rest", () => {
    expect(timeline([1000, 500, 2000])).toEqual({
      starts: [0, 1000, 1500],
      total: 3500
    });
  });

  it("is empty for no steps rather than NaN", () => {
    expect(timeline([])).toEqual({ starts: [], total: 0 });
  });
});

describe("formatClock", () => {
  it("is m:ss with a padded seconds field", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9_000)).toBe("0:09");
    expect(formatClock(19_000)).toBe("0:19");
    expect(formatClock(75_000)).toBe("1:15");
  });

  it("FLOORS, so the clock never reads the total early", () => {
    // Rounding showed `0:19 / 0:19` with a step still to play.
    expect(formatClock(18_600)).toBe("0:18");
  });

  it("never goes negative", () => {
    expect(formatClock(-500)).toBe("0:00");
  });
});

describe("stepProgress", () => {
  it("is the fraction played", () => {
    expect(stepProgress(500, 1000)).toBe(0.5);
  });

  it("clamps both ends", () => {
    expect(stepProgress(-10, 1000)).toBe(0);
    expect(stepProgress(5000, 1000)).toBe(1);
  });

  it("calls a zero-length step complete rather than dividing by zero", () => {
    expect(stepProgress(0, 0)).toBe(1);
  });
});

describe("indexAtFraction", () => {
  // Deliberately unequal: a step with a long insertion owns more of the bar.
  const holds = [1000, 3000, 1000];
  const { starts, total } = timeline(holds);

  it("weights by DURATION, not by step count", () => {
    // Half way along a 5s timeline is 2.5s, which is inside step 1 (1s–4s).
    // floor(0.5 * 3) would have said step 1 here too, so use a point where
    // the two disagree: 0.25 is 1.25s — step 1, while floor(0.25*3) is 0.
    expect(indexAtFraction(starts, holds, total, 0.25)).toBe(1);
  });

  it("lands on the first step at the very start", () => {
    expect(indexAtFraction(starts, holds, total, 0)).toBe(0);
  });

  it("lands on the last step at the very end", () => {
    expect(indexAtFraction(starts, holds, total, 1)).toBe(2);
  });

  it("clamps a fraction outside the bar", () => {
    expect(indexAtFraction(starts, holds, total, -3)).toBe(0);
    expect(indexAtFraction(starts, holds, total, 9)).toBe(2);
  });
});

describe("indexAtTime", () => {
  const holds = [1000, 3000, 1000];
  const { starts } = timeline(holds);

  it("finds the step a moment belongs to", () => {
    expect(indexAtTime(starts, holds, 0)).toBe(0);
    expect(indexAtTime(starts, holds, 999)).toBe(0);
    expect(indexAtTime(starts, holds, 1000)).toBe(1);
    expect(indexAtTime(starts, holds, 4000)).toBe(2);
  });

  it("is 0 when there are no steps", () => {
    expect(indexAtTime([], [], 500)).toBe(0);
  });
});
