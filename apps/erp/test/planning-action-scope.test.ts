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

const partFilter = { column: "type", operator: "eq", value: "Part" };

describe("resolvePlanningActionScope", () => {
  it("passes the grid's own filters through and restricts nothing", () => {
    expect(resolvePlanningActionScope({ filters: [partFilter] })).toEqual({
      gridFilters: [partFilter],
      actionTypes: undefined,
      actionAssignees: undefined
    });
  });

  it("strips the Actions and Assignee filters into the RPC's arguments", () => {
    expect(
      resolvePlanningActionScope({
        filters: [
          partFilter,
          { column: PLANNING_ACTIONS_COLUMN, operator: "eq", value: "Cancel" },
          { column: PLANNING_ASSIGNEE_COLUMN, operator: "eq", value: "user-a" }
        ]
      })
    ).toEqual({
      gridFilters: [partFilter],
      actionTypes: ["Cancel"],
      actionAssignees: ["user-a"]
    });
  });

  it.each([
    ["actionTypes", PLANNING_ACTIONS_COLUMN],
    ["actionAssignees", PLANNING_ASSIGNEE_COLUMN]
  ] as const)(
    "reads the `in` encoding into %s without duplicates",
    (key, column) => {
      const scope = resolvePlanningActionScope({
        filters: [
          { column, operator: "in", value: "x,y" },
          { column, operator: "eq", value: "x" }
        ]
      });
      expect(scope[key]).toEqual(["x", "y"]);
    }
  );

  it.each([
    ["actionTypes", PLANNING_ACTIONS_COLUMN],
    ["actionAssignees", PLANNING_ASSIGNEE_COLUMN]
  ] as const)("an empty value restricts no %s", (key, column) => {
    const scope = resolvePlanningActionScope({
      filters: [{ column, operator: "eq", value: "" }]
    });
    expect(scope[key]).toBeUndefined();
  });
});

describe("actionsOfTypes", () => {
  const actions = [
    { id: "a", type: "Expedite" },
    { id: "b", type: "Defer" },
    { id: "c", type: "Expedite" },
    { id: "d", type: "Cancel" }
  ] as const;

  it.each([undefined, null, []])(
    "shows every action when the type filter is %j",
    (types) => {
      expect(actionsOfTypes(actions, types)).toEqual([...actions]);
    }
  );

  it.each([
    [["Expedite"], ["a", "c"]],
    [["Cancel", "Defer"], ["b", "d"]],
    [["Order"], []]
  ])("keeps only actions of %j, in the original order", (types, ids) => {
    expect(actionsOfTypes(actions, types).map((a) => a.id)).toEqual(ids);
  });
});
