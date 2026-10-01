// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  PLANNING_ACTIONS_COLUMN,
  resolvePlanningActionScope
} from "../app/modules/production/ui/Planning/planning-action-scope";

describe("resolvePlanningActionScope", () => {
  it("passes the grid's own filters through untouched and restricts nothing", () => {
    const filters = [{ column: "type", operator: "eq", value: "Part" }];
    expect(
      resolvePlanningActionScope({ filters, scope: null, userId: "me" })
    ).toEqual({
      gridFilters: filters,
      actionTypes: undefined,
      actionAssignee: undefined
    });
  });

  it("strips the Actions-column filter and returns it as the RPC's type argument", () => {
    const { gridFilters, actionTypes } = resolvePlanningActionScope({
      filters: [
        { column: "type", operator: "eq", value: "Part" },
        { column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" }
      ],
      scope: null,
      userId: "me"
    });
    expect(gridFilters).toEqual([
      { column: "type", operator: "eq", value: "Part" }
    ]);
    expect(actionTypes).toEqual(["Cancel"]);
  });

  it("accepts the multi-value `in` encoding, without duplicates", () => {
    expect(
      resolvePlanningActionScope({
        filters: [
          {
            column: PLANNING_ACTIONS_COLUMN,
            operator: "in",
            value: "Cancel,Order"
          },
          { column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" }
        ],
        scope: null,
        userId: "me"
      }).actionTypes
    ).toEqual(["Cancel", "Order"]);
  });

  it("turns the `mine` scope into the assignee argument", () => {
    expect(
      resolvePlanningActionScope({ filters: [], scope: "mine", userId: "me" })
    ).toEqual({
      gridFilters: [],
      actionTypes: undefined,
      actionAssignee: "me"
    });
  });

  it("ignores an unknown scope value", () => {
    expect(
      resolvePlanningActionScope({ filters: [], scope: "all", userId: "me" })
        .actionAssignee
    ).toBeUndefined();
  });

  it("returns scope and type together — the RPC matches both on the same action", () => {
    expect(
      resolvePlanningActionScope({
        filters: [
          { column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" }
        ],
        scope: "mine",
        userId: "me"
      })
    ).toEqual({
      gridFilters: [],
      actionTypes: ["Cancel"],
      actionAssignee: "me"
    });
  });

  it("an empty filter value restricts nothing", () => {
    expect(
      resolvePlanningActionScope({
        filters: [{ column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "" }],
        scope: null,
        userId: "me"
      }).actionTypes
    ).toBeUndefined();
  });
});
