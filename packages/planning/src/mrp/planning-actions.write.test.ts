// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { kindOf, recordingDatabase } from "./__fixtures__/recording-driver";
import { PlannedOrdersChangedError } from "./planned-order-write";
import {
  diffPlanningActions,
  type ExistingPlanningAction,
  groupPatchUpdates,
  type PlanningActionCandidate,
  writePlanningActions
} from "./planning-actions";

describe("groupPatchUpdates", () => {
  // One UPDATE per row was thousands of round trips on the weekly roll.
  it("puts rows that change the same columns in one group, whatever the key order", () => {
    expect(
      groupPatchUpdates([
        { id: "a1", patch: { periodId: "p2" } },
        { id: "a2", patch: { suggestedQuantity: 12, status: "Open" } },
        { id: "a3", patch: { periodId: "p3" } },
        { id: "a4", patch: { status: "Dismissed", suggestedQuantity: 4 } }
      ])
    ).toEqual([
      {
        columns: ["periodId"],
        rows: [
          ["a1", "p2"],
          ["a3", "p3"]
        ]
      },
      {
        columns: ["status", "suggestedQuantity"],
        rows: [
          ["a2", "Open", 12],
          ["a4", "Dismissed", 4]
        ]
      }
    ]);
  });

  it("writes trigger values as JSON and a cleared value as null", () => {
    expect(
      groupPatchUpdates([
        {
          id: "a1",
          patch: { triggerValues: { reorderPoint: 5 }, reason: null }
        },
        {
          id: "a2",
          patch: { triggerValues: null, reason: "Below reorder point" }
        }
      ])
    ).toEqual([
      {
        columns: ["reason", "triggerValues"],
        rows: [
          ["a1", null, '{"reorderPoint":5}'],
          ["a2", "Below reorder point", null]
        ]
      }
    ]);
  });

  it("refuses a patch column it has no type for", () => {
    expect(() =>
      groupPatchUpdates([
        { id: "a1", patch: { periodId: "p2" } },
        { id: "a2", patch: { bogus: 1 } }
      ])
    ).toThrow(/bogus/);
  });
});

describe("diffPlanningActions on a re-run", () => {
  // A run writes the actions it computes; the next run with the same inputs
  // reads them back and must change nothing. The common rows written before
  // the segment existed read back with segment '' and no owners.
  it("changes nothing on a second run with the same segmented and Transfer inputs", () => {
    const base: PlanningActionCandidate = {
      itemId: "i1",
      locationId: "l1",
      periodId: "p1",
      type: "Order",
      suggestedQuantity: 7,
      suggestedDate: "2026-10-05",
      horizonDate: "2026-10-05",
      latestOrderDate: "2026-10-05",
      isASAP: false,
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId: null,
      requiresManualAction: false,
      supplierId: null,
      policyName: "Lot-for-Lot",
      reason: null,
      triggerValues: null,
      assignee: null
    };
    const candidates: PlanningActionCandidate[] = [
      { ...base, planningSegmentId: "", policyName: "Fixed Reorder Quantity" },
      { ...base, planningSegmentId: "prj_1" },
      {
        ...base,
        type: "Transfer",
        planningSegmentId: "prj_1",
        suggestedQuantity: 8,
        latestOrderDate: null,
        policyName: null,
        reason: "Common stock not needed within the horizon",
        fromProjectId: null,
        toProjectId: "prj_1"
      }
    ];
    const stored: ExistingPlanningAction[] = candidates.map((c, i) => ({
      ...c,
      id: `a${i}`,
      type: c.type,
      status: "Open",
      assigneeOverridden: false,
      planningSegmentId: c.planningSegmentId ?? "",
      fromProjectId: c.fromProjectId ?? null,
      toProjectId: c.toProjectId ?? null
    }));

    const diff = diffPlanningActions({
      existing: stored,
      candidates,
      toleranceDays: 7,
      periods: [{ id: "p1" }]
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });
});

describe("writePlanningActions after the run's planned-order write", () => {
  // The Phase-7 write committed plo-1; the worklist names it.
  const snapshot = {
    readStart: "2026-11-14 10:00:00+00",
    rows: [{ id: "plo-1", status: "Planned", updatedAt: null }]
  };
  const cancel: PlanningActionCandidate = {
    itemId: "i1",
    locationId: "l1",
    planningSegmentId: "",
    periodId: "p1",
    type: "Cancel",
    suggestedQuantity: 5,
    suggestedDate: "2026-11-20",
    horizonDate: "2026-11-20",
    latestOrderDate: null,
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    plannedOrderId: "plo-1",
    requiresManualAction: false,
    supplierId: null,
    policyName: null,
    reason: "No remaining requirement for this order",
    triggerValues: null,
    assignee: null
  };
  const write = (rows: { id: string; status: string }[]) => {
    const { db, driver } = recordingDatabase(rows);
    const result = writePlanningActions(db, {
      companyId: "co-1",
      userId: "user-1",
      candidates: [cancel],
      periods: [{ id: "p1", startDate: "2026-11-15" }],
      toleranceDays: 7,
      plannedOrderSnapshot: snapshot
    });
    return { result, steps: () => driver.log.map(kindOf) };
  };

  // A person cancelled plo-1 between the two writes: the action's insert
  // would fail on its foreign key, so the run plans again instead.
  it("writes nothing when a planned order changed after the planned-order write", async () => {
    const { result, steps } = write([]);
    await expect(result).rejects.toBeInstanceOf(PlannedOrdersChangedError);
    expect(steps()).toEqual(["begin", "lock", "check", "rollback"]);
  });

  it("writes the worklist when the planned orders are as the run wrote them", async () => {
    const { result, steps } = write([{ id: "plo-1", status: "Planned" }]);
    await expect(result).resolves.toMatchObject({
      inserts: [expect.objectContaining({ plannedOrderId: "plo-1" })]
    });
    expect(steps()).toEqual([
      "begin",
      "lock",
      "check",
      "select",
      "insert",
      "commit"
    ]);
  });
});
