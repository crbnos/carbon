// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { parseStationFilters } from "./stationFilter";

describe("parseStationFilters", () => {
  it("reads a stored map", () => {
    expect(parseStationFilters('{"inst:comp":true}')).toEqual({
      "inst:comp": true
    });
  });

  it("is empty for nothing, rubbish, or the wrong shape", () => {
    // Falling back to {} means every scope reads `false` — the whole floor.
    // That is the safe default: a corrupt blob must never silently hide six
    // of seven work centres.
    expect(parseStationFilters(null)).toEqual({});
    expect(parseStationFilters("not json")).toEqual({});
    expect(parseStationFilters("[true]")).toEqual({});
    expect(parseStationFilters("null")).toEqual({});
    expect(parseStationFilters('"true"')).toEqual({});
  });

  it("drops entries that are not booleans", () => {
    // A date left by the previous version of this file must not read as "on".
    expect(
      parseStationFilters('{"a":true,"b":"2026-10-03","c":1,"d":null}')
    ).toEqual({ a: true });
  });

  it("keeps an explicit false, which is not the same as absent", () => {
    expect(parseStationFilters('{"a":false}')).toEqual({ a: false });
  });
});
