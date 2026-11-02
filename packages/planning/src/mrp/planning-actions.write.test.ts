// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  diffPlanningActions,
  type ExistingPlanningAction,
  groupPatchUpdates,
  type PlanningActionCandidate
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
