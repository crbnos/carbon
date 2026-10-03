// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isStationDismissed, parseStationOverrides } from "./stationOverride";

describe("isStationDismissed", () => {
  it("is false when nothing was ever dismissed", () => {
    expect(isStationDismissed(null, { deviceDate: "2026-10-03" })).toBe(false);
  });

  it("holds for the day it was dismissed", () => {
    expect(isStationDismissed("2026-10-03", { deviceDate: "2026-10-03" })).toBe(
      true
    );
  });

  it("lapses the next day, so the station default comes back", () => {
    // The whole point of storing a DATE rather than a boolean: an operator who
    // dismissed their station yesterday should still open on it this morning.
    expect(isStationDismissed("2026-10-02", { deviceDate: "2026-10-03" })).toBe(
      false
    );
  });

  it("accepts the server's date when the device disagrees", () => {
    // The server compares against the LOCATION's today. An operator a timezone
    // away from their plant, or working near midnight, has a device date that
    // is a day out; the payload's `peopleDate` is the authority.
    expect(
      isStationDismissed("2026-10-04", {
        deviceDate: "2026-10-03",
        serverDate: "2026-10-04"
      })
    ).toBe(true);
  });

  it("stays dismissed when neither date matches", () => {
    expect(
      isStationDismissed("2026-10-01", {
        deviceDate: "2026-10-03",
        serverDate: "2026-10-04"
      })
    ).toBe(false);
  });
});

describe("parseStationOverrides", () => {
  it("reads a stored map", () => {
    expect(parseStationOverrides('{"inst:comp":"2026-10-03"}')).toEqual({
      "inst:comp": "2026-10-03"
    });
  });

  it("is empty for nothing, rubbish, or the wrong shape", () => {
    // A corrupt blob must not stop the board loading — the default without it
    // is simply that the station applies.
    expect(parseStationOverrides(null)).toEqual({});
    expect(parseStationOverrides("not json")).toEqual({});
    expect(parseStationOverrides("[1,2]")).toEqual({});
    expect(parseStationOverrides("null")).toEqual({});
  });

  it("drops entries that are not dates", () => {
    expect(parseStationOverrides('{"a":"2026-10-03","b":42,"c":null}')).toEqual(
      { a: "2026-10-03" }
    );
  });
});
