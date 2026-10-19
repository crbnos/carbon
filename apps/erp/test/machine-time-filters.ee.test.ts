// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  machineTimeQueueKeyset,
  parseMachineTimeListFilters
} from "../app/modules/production/ui/MachineTime/machine-time-filters.ee";

function parse(query: string) {
  return parseMachineTimeListFilters(new URLSearchParams(query));
}

describe("parseMachineTimeListFilters", () => {
  it("reads a startTime range as two inclusive days", () => {
    const filters = parse("filter=startTime:between:2026-10-01,2026-10-05");

    expect(filters.start).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(filters.end).toEqual({ from: null, to: null });
  });

  it("leaves an open-ended range open", () => {
    const filters = parse("filter=endTime:between:2026-10-01,");

    expect(filters.end).toEqual({ from: "2026-10-01", to: null });
  });

  it("drops a bound that is not a date", () => {
    const filters = parse("filter=startTime:between:2026-13-40,yesterday");

    expect(filters.start).toEqual({ from: null, to: null });
  });

  it("splits a work center filter into ids", () => {
    const filters = parse("filter=workCenterId:in:a,b");

    expect(filters.workCenterIds).toEqual(["a", "b"]);
  });

  it("ignores a state that is not Running or Stopped", () => {
    const filters = parse("filter=state:eq:Paused");

    expect(filters.state).toBeNull();
  });

  it("reads the search, and none when it is empty", () => {
    expect(parse("search=Haas").search).toBe("Haas");
    expect(parse("search=").search).toBeNull();
    expect(parse("").search).toBeNull();
  });

  it("splits a location filter into ids", () => {
    const filters = parse("filter=locationId:in:loc1,loc2");

    expect(filters.locationIds).toEqual(["loc1", "loc2"]);
    expect(filters.workCenterIds).toEqual([]);
  });

  it("reads the Stopped state", () => {
    expect(parse("filter=state:eq:Stopped").state).toBe("Stopped");
  });

  it("reads several filters together", () => {
    const filters = parse(
      [
        "search=Mill",
        "filter=workCenterId:in:wc1",
        "filter=locationId:in:loc1",
        "filter=startTime:between:2026-10-01,2026-10-05",
        "filter=endTime:between:,2026-10-06",
        "filter=state:eq:Running"
      ].join("&")
    );

    expect(filters).toEqual({
      search: "Mill",
      workCenterIds: ["wc1"],
      locationIds: ["loc1"],
      start: { from: "2026-10-01", to: "2026-10-05" },
      end: { from: null, to: "2026-10-06" },
      state: "Running"
    });
  });
});

describe("machineTimeQueueKeyset", () => {
  const keyset = machineTimeQueueKeyset({
    id: "umt_b",
    startTime: "2026-10-12T15:00:00+00:00"
  });

  it("puts a later start, or the same start and a greater id, above", () => {
    expect(keyset.above).toBe(
      'startTime.gt."2026-10-12T15:00:00+00:00",and(startTime.eq."2026-10-12T15:00:00+00:00",id.gt.umt_b)'
    );
  });

  it("puts an earlier start, or the same start and a smaller id, below", () => {
    expect(keyset.below).toBe(
      'startTime.lt."2026-10-12T15:00:00+00:00",and(startTime.eq."2026-10-12T15:00:00+00:00",id.lt.umt_b)'
    );
  });
});
