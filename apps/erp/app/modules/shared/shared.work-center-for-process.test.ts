// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { workCenterForProcess } from "./shared.utils";

const base = (
  overrides: Partial<Parameters<typeof workCenterForProcess>[0]> = {}
) =>
  workCenterForProcess({
    workCenterId: "wc_weld",
    processWorkCenters: [
      { id: "wc_weld", locationId: "loc_a" },
      { id: "wc_weld_2", locationId: "loc_b" }
    ],
    ...overrides
  });

describe("workCenterForProcess", () => {
  it("keeps the work center when it runs the new process", () => {
    expect(base()).toBe("wc_weld");
  });

  it("clears the work center when it does not run the new process", () => {
    expect(base({ workCenterId: "wc_inspect" })).toBe("");
  });

  it("clears the work center when the new process has no work centers", () => {
    expect(base({ processWorkCenters: [] })).toBe("");
  });

  it("clears a work center that runs the process at another location", () => {
    expect(base({ workCenterId: "wc_weld_2", locationId: "loc_a" })).toBe("");
  });

  it("keeps a work center at the picker's location", () => {
    expect(base({ locationId: "loc_a" })).toBe("wc_weld");
  });

  it.each([null, undefined, ""])("stays empty when none was set (%s)", (id) =>
    expect(base({ workCenterId: id })).toBe("")
  );
});
