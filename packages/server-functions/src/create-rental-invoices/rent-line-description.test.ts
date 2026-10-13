// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { rentLineDescription } from "./index";

const period = {
  cycle: "Calendar Month" as const,
  periodStart: "2026-10-07",
  periodEnd: "2026-10-31",
  days: 25,
  rateUnitApplied: "Week" as const,
  isAdjustment: false
};

it("names the unit by its asset name and serial number", () => {
  expect(
    rentLineDescription({
      ...period,
      assetName: "Skid Steer 4",
      serialNumber: "SN-1001"
    })
  ).toBe(
    "2026-10-07 – 2026-10-31 · 25 days · 4 × Week rate — Skid Steer 4 SN-1001"
  );
});

it("does not repeat a serial number the asset's name already carries", () => {
  expect(
    rentLineDescription({
      ...period,
      assetName: "Reaction Wheel 0.010 Nm RW-SN-T2",
      serialNumber: "RW-SN-T2"
    })
  ).toBe(
    "2026-10-07 – 2026-10-31 · 25 days · 4 × Week rate — Reaction Wheel 0.010 Nm RW-SN-T2"
  );
});
