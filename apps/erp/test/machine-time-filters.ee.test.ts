// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { parseMachineTimeListFilters } from "../app/modules/production/ui/MachineTime/machine-time-filters.ee";

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
});
