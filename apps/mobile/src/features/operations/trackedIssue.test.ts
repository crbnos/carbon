// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isExpired,
  matchEntityToScan,
  selectableEntities,
  serialSlotsLeft,
  trackedIssueBody
} from "./trackedIssue";

describe("matchEntityToScan", () => {
  const entities = [
    { id: "te_abc", readableId: "LOT-1", quantity: 5 },
    { id: "te_def", readableId: "LOT-10", quantity: 5 }
  ];

  it("matches the id or the readable id exactly, whatever the case", () => {
    expect(matchEntityToScan(entities, "lot-1")?.id).toBe("te_abc");
    expect(matchEntityToScan(entities, " TE_DEF\n")?.id).toBe("te_def");
  });

  it("never matches a prefix", () => {
    // "LOT-1" issuing "LOT-10" is the wrong lot in a unit's genealogy.
    expect(matchEntityToScan(entities, "LOT")).toBeNull();
    expect(matchEntityToScan(entities, "LOT-100")).toBeNull();
    expect(matchEntityToScan(entities, "")).toBeNull();
  });
});

describe("expiry", () => {
  it("is expired the day AFTER its date, not on it", () => {
    expect(isExpired("2026-10-02", "2026-10-03")).toBe(true);
    expect(isExpired("2026-10-03", "2026-10-03")).toBe(false);
    expect(isExpired(null, "2026-10-03")).toBe(false);
    // A timestamp is read by its date part.
    expect(isExpired("2026-10-02T23:59:59Z", "2026-10-03")).toBe(true);
  });

  it("hides expired stock under Block and flags it otherwise", () => {
    const entities = [
      { id: "old", quantity: 1, expirationDate: "2026-01-01" },
      { id: "new", quantity: 1, expirationDate: "2027-01-01" }
    ];
    expect(
      selectableEntities(entities, "Block", "2026-10-03").map((e) => e.id)
    ).toEqual(["new"]);
    expect(
      selectableEntities(entities, "Warn", "2026-10-03").map((e) => [
        e.id,
        e.expired
      ])
    ).toEqual([
      ["old", true],
      ["new", false]
    ]);
  });
});

describe("trackedIssueBody", () => {
  it("makes the UNIT the parent and the scanned parts its children", () => {
    // Swapped, the request asks the server to consume a unit into itself.
    expect(
      trackedIssueBody({
        materialId: "jm_1",
        parentEntityId: "te_unit",
        children: [{ trackedEntityId: "te_battery", quantity: 1 }]
      })
    ).toEqual({
      materialId: "jm_1",
      parentTrackedEntityId: "te_unit",
      children: [{ trackedEntityId: "te_battery", quantity: 1 }]
    });
  });

  it("stamps the step and the 1-based unit when it is given them", () => {
    const body = trackedIssueBody({
      materialId: "jm_1",
      parentEntityId: "te_lot",
      children: [{ trackedEntityId: "te_tire", quantity: 2 }],
      jobOperationStepId: "step_3",
      unitNumber: 4
    });
    expect(body).toMatchObject({ jobOperationStepId: "step_3", unitNumber: 4 });
  });

  it("names the item instead when there is no material line", () => {
    const body = trackedIssueBody({
      materialId: null,
      itemId: "item_9",
      parentEntityId: "te_unit",
      children: []
    });
    expect(body).toMatchObject({ itemId: "item_9" });
    expect(body).not.toHaveProperty("materialId");
  });

  it("overrides an expiry only with a reason", () => {
    const base = {
      materialId: "jm_1",
      parentEntityId: "te_unit",
      children: [{ trackedEntityId: "te_old", quantity: 1 }]
    };
    expect(trackedIssueBody(base)).not.toHaveProperty("overrideExpired");
    expect(
      trackedIssueBody({ ...base, overrideReason: "   " })
    ).not.toHaveProperty("overrideExpired");
    expect(
      trackedIssueBody({ ...base, overrideReason: " QA approved " })
    ).toMatchObject({ overrideExpired: true, overrideReason: "QA approved" });
  });
});

describe("serialSlotsLeft", () => {
  it("caps the selection at what the line still needs", () => {
    expect(serialSlotsLeft({ required: 3, issued: 1, selected: 0 })).toBe(2);
    expect(serialSlotsLeft({ required: 3, issued: 1, selected: 2 })).toBe(0);
  });

  it("allows one more once the line is satisfied", () => {
    // Replacing a damaged part is a real thing to do.
    expect(serialSlotsLeft({ required: 1, issued: 1, selected: 0 })).toBe(1);
    expect(serialSlotsLeft({ required: 1, issued: 1, selected: 1 })).toBe(0);
  });
});
