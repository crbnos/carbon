// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The golden test of the MRP planning core. The fixture holds the inputs of a
// satellite dataset company (a Make item with a 2-level BOM, Buy items, open
// PO lines and jobs, sales order lines, demand projections and a Consume First
// supersession). The snapshot pins the output row for row.
//
// Never edit the snapshot to make a change pass. If it changes, the change
// changed what MRP plans for a company with no project stock.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type PlanCompanyInputs,
  type PlanCompanyOutputs,
  planCompany
} from "./plan-company";

function loadFixture(name: string): PlanCompanyInputs {
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")
  ) as PlanCompanyInputs;
}

const KEY_COLUMNS = ["itemId", "locationId", "periodId", "sourceType"] as const;

// Sorts each output by its key columns, then by the whole row, so the snapshot
// does not depend on Map iteration order.
function sortRows<T extends object>(rows: T[]): T[] {
  const keyOf = (row: T) => {
    const record = row as Record<string, unknown>;
    return [
      ...KEY_COLUMNS.map((column) => String(record[column] ?? "")),
      JSON.stringify(row)
    ].join("\u001f");
  };
  return [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function sorted(outputs: PlanCompanyOutputs) {
  return {
    demandForecastUpserts: sortRows(outputs.demandForecastUpserts),
    demandForecastSourceInserts: sortRows(outputs.demandForecastSourceInserts),
    demandActualUpserts: sortRows(outputs.demandActualUpserts),
    supplyActualUpserts: sortRows(outputs.supplyActualUpserts),
    consumptionUpdates: sortRows(outputs.consumptionUpdates),
    cycleItemIds: [...outputs.cycleItemIds].sort()
  };
}

describe("planCompany", () => {
  it("plans the satellite dataset company as before (golden)", () => {
    const outputs = planCompany(loadFixture("plan-company.basic.json"));
    expect(sorted(outputs)).toMatchSnapshot();
    // No planning group, so nothing to peg.
    expect(outputs.groupPegInputs).toEqual([]);
  });

  // The spec case: project P-101 needs 20 and holds 5. Common holds 10 and
  // needs 2, so 8 is true surplus. P-101 draws 8 and its remainder is 7.
  it("nets a project segment and draws the common true surplus", () => {
    const outputs = planCompany(loadFixture("plan-company.project.json"));
    expect(outputs.commonSurplusDraws).toEqual([
      {
        itemId: "item_p",
        locationId: "loc_plant",
        periodId: "per_w2",
        planningSegmentId: "prj_p101",
        quantity: 8
      }
    ]);
    expect({
      ...sorted(outputs),
      commonSurplusDraws: outputs.commonSurplusDraws
    }).toMatchSnapshot();
  });

  // Projects Phase 3: P-101 (stock 5, needs 20) and P-102 (needs 10) are
  // members of planning group plg_1, so the views put their demand in plg_1.
  const groupFixture = (): PlanCompanyInputs => {
    const fixture = loadFixture("plan-company.project.json");
    return {
      ...fixture,
      stockedProjectIds: ["prj_p101", "prj_p102"],
      projectMaterialLines: [
        {
          id: "pem_p101",
          itemId: "item_p",
          locationId: "loc_plant",
          planningSegmentId: "plg_1",
          projectId: "prj_p101",
          projectElementId: "el_p101",
          quantity: 20,
          requiredDate: "2026-10-14"
        },
        {
          id: "pem_p102",
          itemId: "item_p",
          locationId: "loc_plant",
          planningSegmentId: "plg_1",
          projectId: "prj_p102",
          projectElementId: null,
          quantity: 10,
          requiredDate: "2026-10-14"
        }
      ]
    };
  };
  const projectMaterialActuals = (outputs: PlanCompanyOutputs) =>
    outputs.demandActualUpserts
      .filter((row) => row.sourceType === "Project Material")
      .map((row) => [row.planningSegmentId, Number(row.actualQuantity)])
      .sort();

  it("nets the members of a planning group in the group segment", () => {
    const outputs = planCompany({
      ...groupFixture(),
      planningGroups: [
        { id: "plg_1", memberProjectIds: ["prj_p101", "prj_p102"] }
      ]
    });
    expect(projectMaterialActuals(outputs)).toEqual([["plg_1", 30]]);
    // The group holds P-101's 5 and needs 30, so it draws all 8 of the
    // common true surplus.
    expect(outputs.commonSurplusDraws).toEqual([
      {
        itemId: "item_p",
        locationId: "loc_plant",
        periodId: "per_w2",
        planningSegmentId: "plg_1",
        quantity: 8
      }
    ]);
    // The peg input: each member's demand with its element and need date,
    // and P-101's own stock of 5.
    expect(outputs.groupPegInputs).toHaveLength(1);
    const [input] = outputs.groupPegInputs;
    expect(input).toMatchObject({
      planningGroupId: "plg_1",
      itemId: "item_p",
      locationId: "loc_plant"
    });
    expect(
      input!.demands.map((demand) => [
        demand.projectId,
        demand.projectElementId,
        demand.sourceType,
        demand.sourceId,
        demand.needDate,
        demand.quantity
      ])
    ).toEqual([
      ["prj_p101", "el_p101", "Project Material", "pem_p101", "2026-10-14", 20],
      ["prj_p102", null, "Project Material", "pem_p102", "2026-10-14", 10]
    ]);
    expect(input!.supplies).toEqual([
      {
        supplyType: "Stock",
        supplyId: "prj_p101",
        ownerProjectId: "prj_p101",
        availableDate: "2026-10-10",
        quantity: 5
      }
    ]);
  });

  it("nets each member on its own without the planning groups feature", () => {
    const outputs = planCompany({
      ...groupFixture(),
      ungroupedPlanningGroupIds: ["plg_1"]
    });
    expect(projectMaterialActuals(outputs)).toEqual([
      ["prj_p101", 20],
      ["prj_p102", 10]
    ]);
    expect(outputs.groupPegInputs).toEqual([]);
  });

  it("writes one actual row per segment for the same item, location and week", () => {
    const fixture = loadFixture("plan-company.project.json");
    const jobMaterial = {
      dueDate: "2026-10-21",
      itemId: "item_p",
      jobId: "job_common",
      leadTime: 7,
      locationId: "loc_plant",
      quantityPerParent: 1,
      quantityToIssue: 3
    };
    const outputs = planCompany({
      ...fixture,
      jobMaterialLines: [
        { ...jobMaterial, planningSegmentId: "" },
        { ...jobMaterial, jobId: "job_p101", planningSegmentId: "prj_p101" }
      ]
    });
    const jobMaterialRows = outputs.demandActualUpserts.filter(
      (row) => row.sourceType === "Job Material"
    );
    expect(
      jobMaterialRows.map((row) => row.planningSegmentId ?? "").sort()
    ).toEqual(["", "prj_p101"]);
  });
});
