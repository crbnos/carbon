// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ms } from "./duration";
import type { Duration } from "./types";

describe("ms", () => {
  it.each<[Duration, number]>([
    ["100ms", 100],
    ["1 ms", 1],
    ["10s", 10_000],
    ["0 s", 0],
    ["5m", 300_000],
    ["24 h", 86_400_000],
    ["7d", 604_800_000]
  ])("converts %s to %i milliseconds", (input, expected) => {
    expect(ms(input)).toBe(expected);
  });

  it.each(["invalid", "10", "10x", "", "1  s"])("refuses %j", (input) => {
    expect(() => ms(input as Duration)).toThrow("Unable to parse window size");
  });
});
