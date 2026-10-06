// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  actionsOfTypes,
  PLANNING_ACTIONS_COLUMN,
  PLANNING_ASSIGNEE_COLUMN,
  resolvePlanningActionScope
} from "../app/modules/production/ui/Planning/planning-action-scope";

describe("resolvePlanningActionScope", () => {
  it("passes the grid's own filters through untouched and restricts nothing", () => {
    const filters = [{ column: "type", operator: "eq", value: "Part" }];
    expect(
      resolvePlanningActionScope({ filters })
    ).toEqual({
      gridFilters: filters,
      actionTypes: undefined,
      actionAssignees: undefined
    });
  });

  it("strips the Actions-column filter and returns it as the RPC's type argument", () => {
    const { gridFilters, actionTypes } = resolvePlanningActionScope({
      filters: [
        { column: "type", operator: "eq", value: "Part" },
        { column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" }
      ],
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
          }).actionTypes
    ).toEqual(["Cancel", "Order"]);
  });

  it("strips the Assignee filter and returns its people as the RPC's assignees argument", () => {
    expect(
      resolvePlanningActionScope({
        filters: [
          { column: "type", operator: "eq", value: "Part" },
          { column: PLANNING_ASSIGNEE_COLUMN, operator: "eq", value: "user-a" }
        ]
      })
    ).toEqual({
      gridFilters: [{ column: "type", operator: "eq", value: "Part" }],
      actionTypes: undefined,
      actionAssignees: ["user-a"]
    });
  });

  it("accepts several people in the `in` encoding, without duplicates", () => {
    expect(
      resolvePlanningActionScope({
        filters: [
          {
            column: PLANNING_ASSIGNEE_COLUMN,
            operator: "in",
            value: "user-a,user-b"
          },
          { column: PLANNING_ASSIGNEE_COLUMN, operator: "eq", value: "user-a" }
        ]
      }).actionAssignees
    ).toEqual(["user-a", "user-b"]);
  });

  it("returns assignees and types together — the RPC matches both on the same action", () => {
    expect(
      resolvePlanningActionScope({
        filters: [
          { column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" },
          { column: PLANNING_ASSIGNEE_COLUMN, operator: "eq", value: "user-a" }
        ]
      })
    ).toEqual({
      gridFilters: [],
      actionTypes: ["Cancel"],
      actionAssignees: ["user-a"]
    });
  });

  it("an empty Assignee filter value restricts nothing", () => {
    expect(
      resolvePlanningActionScope({
        filters: [{ column: PLANNING_ASSIGNEE_COLUMN, operator: "eq", value: "" }]
      }).actionAssignees
    ).toBeUndefined();
  });

  it("an empty filter value restricts nothing", () => {
    expect(
      resolvePlanningActionScope({
        filters: [{ column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "" }],
          }).actionTypes
    ).toBeUndefined();
  });
});

describe("actionsOfTypes", () => {
  const actions = [
    { id: "a", type: "Expedite" },
    { id: "b", type: "Defer" },
    { id: "c", type: "Expedite" },
    { id: "d", type: "Cancel" }
  ] as const;

  it("shows every action when the grid is not filtered by type", () => {
    expect(actionsOfTypes(actions, undefined)).toEqual([...actions]);
    expect(actionsOfTypes(actions, null)).toEqual([...actions]);
    expect(actionsOfTypes(actions, [])).toEqual([...actions]);
  });

  it("keeps only the filtered type, in the original order", () => {
    expect(actionsOfTypes(actions, ["Expedite"]).map((a) => a.id)).toEqual([
      "a",
      "c"
    ]);
  });

  it("keeps any of several filtered types", () => {
    expect(
      actionsOfTypes(actions, ["Cancel", "Defer"]).map((a) => a.id)
    ).toEqual(["b", "d"]);
  });

  it("returns nothing when the row has no action of the filtered type", () => {
    expect(actionsOfTypes(actions, ["Order"])).toEqual([]);
  });
});
