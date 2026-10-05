// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { nextStep } from "./hibernate.js";

const IDLE = 30 * 60_000;

describe("nextStep", () => {
  it("sleeps only once the quiet spell reaches the limit", () => {
    expect(nextStep("awake", IDLE - 1, 0, 0, IDLE)).toBeNull();
    expect(nextStep("awake", IDLE, 0, 0, IDLE)).toBe("sleep");
  });

  it("stays asleep until a request lands after it went to sleep", () => {
    expect(nextStep("asleep", 5000, 900, 1000, IDLE)).toBeNull();
    expect(nextStep("asleep", 5000, 1001, 1000, IDLE)).toBe("wake");
  });
});
