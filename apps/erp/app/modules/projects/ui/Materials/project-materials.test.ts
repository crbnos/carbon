// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ProjectMaterialRow } from "../../projects.service";
import {
  filterMaterialRows,
  groupMaterialRows,
  NO_ELEMENT_GROUP,
  NO_SUPPLY
} from "./project-materials";

const row = (over: Partial<ProjectMaterialRow>): ProjectMaterialRow => ({
  rowKind: "Plan",
  projectElementMaterialId: "pjp1",
  projectElementId: "el1",
  elementReadableId: "ABC-1",
  elementName: "Frame",
  elementSequence: 1,
  elementStateName: "In Progress",
  elementStateGroup: "Started",
  elementStateColor: "#000000",
  itemId: "item1",
  itemReadableId: "P-100",
  itemName: "Bracket",
  methodType: "Purchase to Order",
  unitOfMeasureCode: "EA",
  quantityRequired: 10,
  quantityOrdered: 0,
  quantityReceived: 0,
  quantityIssued: 0,
  quantityRemaining: 10,
  requiredDate: null,
  issueStatus: "Not issued",
  supplies: [],
  projectOnHand: null,
  unassignedOnHand: null,
  ...over
});

const noFilters = { search: null, supplyStatus: [], issueStatus: [] };

describe("filterMaterialRows", () => {
  it("matches the search against the element name", () => {
    const rows = [
      row({ projectElementMaterialId: "a", elementName: "Frame" }),
      row({ projectElementMaterialId: "b", elementName: "Motor mount" })
    ];
    const kept = filterMaterialRows(rows, { ...noFilters, search: "motor" });
    expect(kept.map((r) => r.projectElementMaterialId)).toEqual(["b"]);
  });

  it("keeps a line with no supply but not a Pull from Inventory line for No supply", () => {
    const rows = [
      row({ projectElementMaterialId: "buy", methodType: "Purchase to Order" }),
      row({
        projectElementMaterialId: "pull",
        methodType: "Pull from Inventory"
      })
    ];
    const kept = filterMaterialRows(rows, {
      ...noFilters,
      supplyStatus: [NO_SUPPLY]
    });
    expect(kept.map((r) => r.projectElementMaterialId)).toEqual(["buy"]);
  });

  it("does not call an Unplanned row with no supply No supply", () => {
    const rows = [
      row({ projectElementMaterialId: "make", methodType: "Make to Order" }),
      row({
        rowKind: "Unplanned",
        projectElementMaterialId: null,
        methodType: null,
        issueStatus: "Unplanned"
      })
    ];
    const kept = filterMaterialRows(rows, {
      ...noFilters,
      supplyStatus: [NO_SUPPLY]
    });
    expect(kept.map((r) => r.projectElementMaterialId)).toEqual(["make"]);
  });

  it("keeps only the rows of the chosen issue status", () => {
    const rows = [
      row({ projectElementMaterialId: "plan", issueStatus: "Not issued" }),
      row({
        rowKind: "Unplanned",
        projectElementMaterialId: null,
        issueStatus: "Unplanned"
      })
    ];
    const kept = filterMaterialRows(rows, {
      ...noFilters,
      issueStatus: ["Unplanned"]
    });
    expect(kept.map((r) => r.rowKind)).toEqual(["Unplanned"]);
  });
});

describe("groupMaterialRows", () => {
  it("puts the rows with no element in the last element group", () => {
    const rows = [
      row({ projectElementId: null, projectElementMaterialId: null }),
      row({ projectElementId: "el2" }),
      row({ projectElementId: "el1" })
    ];
    const keys = groupMaterialRows(rows, "element").map((g) => g.key);
    expect(keys).toEqual(["el2", "el1", NO_ELEMENT_GROUP]);
  });

  it("totals one item over 2 elements in one unit", () => {
    const rows = [
      row({
        projectElementId: "el1",
        quantityRequired: 4,
        quantityIssued: 1,
        quantityRemaining: 3
      }),
      row({
        projectElementId: "el2",
        quantityRequired: 6,
        quantityIssued: 6,
        quantityRemaining: 0
      })
    ];
    const [group] = groupMaterialRows(rows, "item");
    expect(group?.totals).toEqual({
      quantityRequired: 10,
      quantityOrdered: 0,
      quantityReceived: 0,
      quantityIssued: 7,
      quantityRemaining: 3
    });
  });

  it("gives an element group no totals, since its rows are different items", () => {
    const rows = [
      row({ itemId: "bolt", itemReadableId: "B-1" }),
      row({ itemId: "motor", itemReadableId: "M-1" })
    ];
    const [group] = groupMaterialRows(rows, "element");
    expect(group?.totals).toBeNull();
  });

  it("gives no totals when the rows of an item use 2 units", () => {
    const rows = [
      row({ projectElementId: "el1", unitOfMeasureCode: "EA" }),
      row({ projectElementId: "el2", unitOfMeasureCode: "BOX" })
    ];
    const [group] = groupMaterialRows(rows, "item");
    expect(group?.totals).toBeNull();
  });
});
