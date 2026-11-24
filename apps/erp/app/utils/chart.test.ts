// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { KPIs as ProductionKPIs } from "~/modules/production/production.models";
import { MaintenanceKPIs } from "~/modules/resources/resources.models";
import { isKpiChangeGood } from "./chart";

const KPIS = [...MaintenanceKPIs, ...ProductionKPIs];

/** The badge for a 50% rise and a 50% fall: true is green. */
const badges = (key: (typeof KPIS)[number]["key"]) => {
  const kpi = KPIS.find((k) => k.key === key)!;
  return { rise: isKpiChangeGood(kpi, 50), fall: isKpiChangeGood(kpi, -50) };
};

describe("isKpiChangeGood", () => {
  it.each([
    "mttr",
    "sparePartCost",
    "worstPerformingMachines",
    "sparePartConsumption",
    "estimatesVsActuals",
    "completionTime"
  ] as const)("shows a rise in %s as bad and a fall as good", (key) => {
    expect(badges(key)).toEqual({ rise: false, fall: true });
  });

  it.each(["mtbf", "utilization"] as const)(
    "shows a rise in %s as good and a fall as bad",
    (key) => {
      expect(badges(key)).toEqual({ rise: true, fall: false });
    }
  );

  it("shows no change as good whichever way the KPI points", () => {
    expect([
      isKpiChangeGood({ lowerIsBetter: true }, 0),
      isKpiChangeGood({ lowerIsBetter: false }, 0)
    ]).toEqual([true, true]);
  });
});
