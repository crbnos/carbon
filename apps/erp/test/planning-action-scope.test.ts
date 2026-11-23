// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  actionsOfTypes,
  PLANNING_ACTIONS_COLUMN,
  PLANNING_ASSIGNEE_COLUMN,
  PLANNING_SEGMENT_COLUMN,
  planningRowKey,
  planningSegmentFilter,
  resolvePlanningActionScope,
  resolvePlanningSegmentScope,
  withPlanningActions
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

describe("withPlanningActions", () => {
  it("gives each row its own actions, and none to a row without any", () => {
    const actions = [
      { id: "a1", itemId: "item-1" },
      { id: "a2", itemId: "item-2" },
      { id: "a3", itemId: "item-1" },
      { id: "a4", itemId: "item-off-page" }
    ];
    expect(
      withPlanningActions(
        [{ id: "item-1" }, { id: "item-2" }, { id: "item-3" }],
        actions
      )
    ).toEqual([
      { id: "item-1", planningActions: [actions[0], actions[2]] },
      { id: "item-2", planningActions: [actions[1]] },
      { id: "item-3", planningActions: [] }
    ]);
  });

  it("gives an item's common row and its project row their own segment's actions", () => {
    const actions = [
      { id: "a1", itemId: "item-1", planningSegmentId: "" },
      { id: "a2", itemId: "item-1", planningSegmentId: "prj_1" }
    ];
    expect(
      withPlanningActions(
        [
          { id: "item-1", planningSegmentId: "" },
          { id: "item-1", planningSegmentId: "prj_1" }
        ],
        actions
      ).map((row) => row.planningActions)
    ).toEqual([[actions[0]], [actions[1]]]);
  });
});

describe("resolvePlanningSegmentScope", () => {
  it("turns the Segment filter into segment ids, Common as ''", () => {
    const filters = [
      { column: "type", operator: "eq", value: "Part" },
      { column: PLANNING_SEGMENT_COLUMN, operator: "in", value: "common,prj_1" }
    ];
    expect(resolvePlanningSegmentScope({ filters })).toEqual({
      gridFilters: [{ column: "type", operator: "eq", value: "Part" }],
      segments: ["", "prj_1"]
    });
  });

  it("keeps every segment without the filter", () => {
    expect(resolvePlanningSegmentScope({ filters: [] }).segments).toBe(
      undefined
    );
  });
});

describe("planningSegmentFilter", () => {
  // an `in` list cannot hold the empty string, so Common is `eq.""`
  it("matches Common with eq and the projects with in", () => {
    expect(planningSegmentFilter(["", "prj_1", "prj_2"])).toBe(
      'planningSegmentId.eq."",planningSegmentId.in.(prj_1,prj_2)'
    );
    expect(planningSegmentFilter([""])).toBe('planningSegmentId.eq.""');
    expect(planningSegmentFilter(["prj_1"])).toBe(
      "planningSegmentId.in.(prj_1)"
    );
  });
});

describe("planningRowKey", () => {
  it("tells an item's common row from its project row", () => {
    expect(planningRowKey({ id: "i1", planningSegmentId: "" })).not.toBe(
      planningRowKey({ id: "i1", planningSegmentId: "prj_1" })
    );
    expect(planningRowKey({ id: "i1" })).toBe(
      planningRowKey({ id: "i1", planningSegmentId: "" })
    );
  });
});
