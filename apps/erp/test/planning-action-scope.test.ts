import { describe, expect, it } from "vitest";
import {
  PLANNING_ACTIONS_COLUMN,
  resolvePlanningActionScope
} from "../app/modules/production/ui/Planning/planning-action-scope";

const actions = [
  { itemId: "a", type: "Expedite", status: "Open", assignee: "me" },
  { itemId: "a", type: "Cancel", status: "Open", assignee: "you" },
  { itemId: "b", type: "Order", status: "Open", assignee: "you" },
  { itemId: "c", type: "Defer", status: "Dismissed", assignee: "me" }
];

describe("resolvePlanningActionScope", () => {
  it("passes the grid's own filters through untouched and restricts nothing", () => {
    const filters = [{ column: "type", operator: "eq", value: "Part" }];
    expect(
      resolvePlanningActionScope({ filters, scope: null, userId: "me", actions })
    ).toEqual({ gridFilters: filters, itemIds: undefined });
  });

  it("strips the Actions-column filter and resolves it to item ids", () => {
    const { gridFilters, itemIds } = resolvePlanningActionScope({
      filters: [
        { column: "type", operator: "eq", value: "Part" },
        { column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" }
      ],
      scope: null,
      userId: "me",
      actions
    });
    expect(gridFilters).toEqual([{ column: "type", operator: "eq", value: "Part" }]);
    expect(itemIds).toEqual(["a"]);
  });

  it("accepts the multi-value `in` encoding", () => {
    expect(
      resolvePlanningActionScope({
        filters: [
          { column: PLANNING_ACTIONS_COLUMN, operator: "in", value: "Cancel,Order" }
        ],
        scope: null,
        userId: "me",
        actions
      }).itemIds
    ).toEqual(["a", "b"]);
  });

  it("scopes to items with an OPEN action assigned to the user", () => {
    expect(
      resolvePlanningActionScope({ filters: [], scope: "mine", userId: "me", actions })
        .itemIds
    ).toEqual(["a"]); // c is only Dismissed
  });

  it("combines scope and type: both must hold on the same action", () => {
    expect(
      resolvePlanningActionScope({
        filters: [{ column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" }],
        scope: "mine",
        userId: "me",
        actions
      }).itemIds
    ).toEqual([]); // a's Cancel is assigned to someone else
  });
});
