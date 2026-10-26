// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  processesOfWorkCenters,
  workCentersOnShift
} from "./shift-work-centers";

// The plant: Day (active) and Weekend (the shift being changed, active).
const base = (
  overrides: Partial<Parameters<typeof workCentersOnShift>[0]> = {}
) =>
  workCentersOnShift({
    shift: { id: "weekend", locationId: "plant" },
    workCenters: [
      { id: "pcb-lab", locationId: "plant", alwaysOn: false }, // all shifts
      { id: "cnc-mill", locationId: "plant", alwaysOn: false }, // Day only
      { id: "tig", locationId: "plant", alwaysOn: false }, // Weekend only
      { id: "tvac", locationId: "plant", alwaysOn: true }, // lights-out
      { id: "flatsat", locationId: "hq", alwaysOn: false } // another location
    ],
    workCenterShifts: [
      { workCenterId: "cnc-mill", shiftId: "day" },
      { workCenterId: "tig", shiftId: "weekend" }
    ],
    activeShiftIds: new Set(["day", "weekend"]),
    ...overrides
  });

describe("workCentersOnShift", () => {
  it("is the stations linked to the shift plus the location's unlinked stations", () => {
    expect(base()).toEqual(["pcb-lab", "tig"]);
  });

  it("keeps a removed shift's own stations: their hours fall back to the location's", () => {
    expect(base({ activeShiftIds: new Set(["day"]) })).toEqual([
      "pcb-lab",
      "tig"
    ]);
  });

  it("treats a station whose only links are inactive shifts as unlinked", () => {
    expect(
      base({
        workCenterShifts: [
          { workCenterId: "cnc-mill", shiftId: "old-night" },
          { workCenterId: "tig", shiftId: "weekend" }
        ]
      })
    ).toEqual(["pcb-lab", "cnc-mill", "tig"]);
  });
});

describe("processesOfWorkCenters", () => {
  it("is every process the affected stations run, once each", () => {
    expect(
      processesOfWorkCenters({
        workCenterIds: ["tig", "pcb-lab"],
        workCenterProcesses: [
          { workCenterId: "tig", processId: "welding" },
          { workCenterId: "pcb-lab", processId: "smt" },
          { workCenterId: "pcb-lab", processId: "welding" },
          { workCenterId: "cnc-mill", processId: "machining" }
        ]
      })
    ).toEqual(["welding", "smt"]);
  });
});
