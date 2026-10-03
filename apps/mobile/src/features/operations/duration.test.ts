// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";

const S = 1_000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("formatDuration", () => {
  it("writes the two largest units", () => {
    // The real values from the Northspoke board: 30,600,000 ms is the
    // assembly operation web shows as "8 hours, 30 minutes".
    expect(formatDuration(30_600_000)).toBe("8h 30m");
    expect(formatDuration(1_680_000)).toBe("28m");
    expect(formatDuration(6_000_000)).toBe("1h 40m");
    expect(formatDuration(2 * D + 4 * H + 9 * M)).toBe("2d 4h");
  });

  it("drops a smaller unit that is zero rather than printing it", () => {
    expect(formatDuration(8 * H)).toBe("8h");
    expect(formatDuration(3 * D)).toBe("3d");
    expect(formatDuration(45 * S)).toBe("45s");
  });

  it("does not skip over a zero unit to borrow a smaller one", () => {
    // 2h 0m 30s is "2h", not "2h 30s": the second unit is the NEXT one down,
    // and pairing hours with seconds reads as a typo.
    expect(formatDuration(2 * H + 30 * S)).toBe("2h");
    expect(formatDuration(1 * D + 5 * M)).toBe("1d");
  });

  it("never rounds up", () => {
    // A plan that says an hour when the routing says under one is wrong.
    expect(formatDuration(59 * M + 59 * S)).toBe("59m 59s");
    expect(formatDuration(H - 1)).toBe("59m 59s");
    expect(formatDuration(23 * H + 59 * M + 59 * S)).toBe("23h 59m");
  });

  it("is null when there is nothing worth showing", () => {
    // Web prints "0 milliseconds" on a card for an operation with no planned
    // time; a row saying so is noise, and the caller hides it on null.
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(999)).toBeNull();
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
