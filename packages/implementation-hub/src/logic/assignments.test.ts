// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { BOARD_TASKS, setupGroupKey } from "../content/board";
import { SETUP_GROUPS } from "../content/setup";
import { SPINE } from "../content/spine";
import type { ImplementationRowData } from "../types";
import {
  type AssignedItem,
  type AssignmentSources,
  isOverdue,
  itemsAssignedTo,
  sortAssigned
} from "./assignments";
import { boardTasksForTier } from "./board";
import { spineForTier } from "./overlay";

const ME = "user_me";
const OTHER = "user_other";

const row = (
  id: string,
  collection: string,
  payload: Record<string, unknown>
): ImplementationRowData => ({
  id,
  collection,
  payload,
  sortOrder: 0
});

const settings = SETUP_GROUPS.find((g) =>
  g.rows.some((r) => r.key === "company")
)!;

function sources(
  overrides: Partial<AssignmentSources> = {}
): AssignmentSources {
  return {
    assignments: new Map(),
    checks: new Map(),
    tasks: boardTasksForTier(BOARD_TASKS, "guided"),
    steps: spineForTier(SPINE, "guided"),
    gateDates: new Map([
      ["gate:discovery", "2026-10-20"],
      ["gate:configure", "2026-11-10"]
    ]),
    setupGroups: SETUP_GROUPS.map((group) => ({
      key: setupGroupKey(group.n),
      title: group.title,
      rows: group.rows
    })),
    rows: [],
    ...overrides
  };
}

describe("itemsAssignedTo", () => {
  it("lists only the viewer's items, from every kind of hub item", () => {
    const items = itemsAssignedTo(
      ME,
      sources({
        assignments: new Map([
          ["task:kickoff", ME],
          ["task:process-mapped", OTHER],
          ["flag:setup.company", ME],
          ["flag:setup.row_setup", ME],
          ["row:row_goal", ME],
          ["row:row_question", ME],
          ["row:row_change", ME],
          ["row:row_theirs", OTHER]
        ]),
        rows: [
          row("row_setup", "setup", { object: "Label printers" }),
          row("row_goal", "objective", { title: "Ship from Carbon" }),
          row("row_question", "question", { question: "Who signs POs?" }),
          row("row_change", "customization", {
            title: "Packing slip layout",
            kind: "documentTemplate",
            status: "agreed"
          }),
          row("row_theirs", "objective", { title: "Not mine" })
        ]
      })
    );

    expect(items.map((i) => [i.itemKey, i.kind, i.page])).toEqual([
      ["task:kickoff", "task", "plan"],
      ["flag:setup.company", "setup", "setup"],
      ["flag:setup.row_setup", "setup", "setup"],
      ["row:row_goal", "objective", "objectives"],
      ["row:row_question", "question", "requirements"],
      ["row:row_change", "customization", "customization"]
    ]);
    expect(items.map((i) => i.label)).toEqual([
      BOARD_TASKS.find((t) => t.key === "kickoff")!.label,
      settings.rows.find((r) => r.key === "company")!.object,
      "Label printers",
      "Ship from Carbon",
      "Who signs POs?",
      "Packing slip layout"
    ]);
  });

  it("gives a task its gate's date and phase, and a setup row the Configure date", () => {
    const [task, setup, custom] = itemsAssignedTo(
      ME,
      sources({
        assignments: new Map([
          ["task:kickoff", ME],
          ["flag:setup.company", ME],
          ["flag:setup.row_setup", ME]
        ]),
        rows: [row("row_setup", "setup", { object: "Label printers" })]
      })
    );
    expect(task!.due).toBe("2026-10-20");
    expect(task!.context).toBe(
      SPINE.find((s) => s.key === "gate:discovery")!.title
    );
    expect(task!.anchor).toBe("plan-gate-discovery");
    expect(setup!.due).toBe("2026-11-10");
    expect(setup!.context).toBe(settings.title);
    expect(setup!.anchor).toBe(`setup-${setupGroupKey(settings.n)}`);
    expect(custom!.due).toBe("2026-11-10");
  });

  it("leaves an item undated when its gate has no date", () => {
    const [task] = itemsAssignedTo(
      ME,
      sources({
        assignments: new Map([["task:kickoff", ME]]),
        gateDates: new Map()
      })
    );
    expect(task!.due).toBeNull();
  });

  it("reads each item's status from the key its own page writes", () => {
    const items = itemsAssignedTo(
      ME,
      sources({
        assignments: new Map([
          ["task:kickoff", ME],
          ["flag:setup.company", ME],
          ["row:row_goal", ME],
          ["row:row_question", ME],
          ["row:row_change", ME]
        ]),
        checks: new Map([
          ["task:kickoff", "prog"],
          ["flag:setup.company", "1"],
          ["check:objective.row_goal", "1"],
          ["check:question.row_question", "1"]
        ]),
        rows: [
          row("row_goal", "objective", { title: "Ship from Carbon" }),
          row("row_question", "question", {
            question: "Who signs POs?",
            answer: "The plant manager"
          }),
          row("row_change", "customization", {
            title: "Old report",
            status: "dropped"
          })
        ]
      })
    );
    expect(items.map((i) => [i.status, i.closed])).toEqual([
      ["prog", false],
      ["done", true],
      ["done", true],
      ["done", true],
      ["dropped", true]
    ]);
  });

  it("ticks manual items with the same write their page makes", () => {
    const items = itemsAssignedTo(
      ME,
      sources({
        assignments: new Map([
          ["task:kickoff", ME],
          ["flag:setup.company", ME],
          ["row:row_goal", ME],
          ["row:row_question", ME]
        ]),
        rows: [
          row("row_goal", "objective", { title: "Ship from Carbon" }),
          row("row_question", "question", { question: "Who signs POs?" })
        ]
      })
    );
    expect(items.map((i) => i.tick)).toEqual([
      { itemKey: "task:kickoff", kind: "task", on: "done", off: "todo" },
      { itemKey: "flag:setup.company", kind: "scopeFlag", on: "1", off: "0" },
      { itemKey: "check:objective.row_goal", kind: "check", on: "1", off: "0" },
      {
        itemKey: "check:question.row_question",
        kind: "check",
        on: "1",
        off: "0"
      }
    ]);
  });

  it("sends a Setup Map task to the Setup Map, with its status from its rows", () => {
    const task = BOARD_TASKS.find((t) => t.setupKeys?.includes("company"))!;
    const [item] = itemsAssignedTo(
      ME,
      sources({
        assignments: new Map([[`task:${task.key}`, ME]]),
        checks: new Map([["flag:setup.company", "1"]])
      })
    );
    expect(item!.page).toBe("setup");
    expect(item!.anchor).toBe(`setup-${task.key}`);
    expect(item!.status).toBe("prog");
    expect(item!.tick).toBeUndefined();
  });

  it("dates an objective and a customization by their own target date", () => {
    const items = itemsAssignedTo(
      ME,
      sources({
        assignments: new Map([
          ["row:row_goal", ME],
          ["row:row_change", ME]
        ]),
        rows: [
          row("row_goal", "objective", {
            title: "Ship from Carbon",
            targetDate: "2026-12-01"
          }),
          row("row_change", "customization", {
            title: "Packing slip layout",
            targetDate: "1 December"
          })
        ]
      })
    );
    expect(items.map((i) => i.due)).toEqual(["2026-12-01", null]);
  });

  it("drops assignments to items the viewer cannot see", () => {
    const items = itemsAssignedTo(
      ME,
      sources({
        // Hypercare is paid-tier only; the row was deleted.
        tasks: boardTasksForTier(BOARD_TASKS, "self_serve"),
        assignments: new Map([
          ["task:hypercare", ME],
          ["row:row_deleted", ME]
        ])
      })
    );
    expect(items).toEqual([]);
  });

  it("lists nothing before the viewer is known", () => {
    expect(
      itemsAssignedTo(
        "",
        sources({ assignments: new Map([["task:kickoff", ""]]) })
      )
    ).toEqual([]);
  });
});

describe("isOverdue", () => {
  const today = "2026-10-06";
  it("is overdue when an open item's date has passed", () => {
    expect(isOverdue("2026-10-05", false, today)).toBe(true);
  });
  it("is not overdue on the due date itself", () => {
    expect(isOverdue("2026-10-06", false, today)).toBe(false);
  });
  it("is never overdue once closed", () => {
    expect(isOverdue("2026-09-01", true, today)).toBe(false);
  });
  it("is never overdue without a date", () => {
    expect(isOverdue(null, false, today)).toBe(false);
    expect(isOverdue(undefined, false, today)).toBe(false);
  });
  it("compares across a month and a year", () => {
    expect(isOverdue("2026-09-30", false, today)).toBe(true);
    expect(isOverdue("2027-01-01", false, today)).toBe(false);
  });
});

describe("sortAssigned", () => {
  const item = (
    itemKey: string,
    due: string | null,
    closed = false
  ): AssignedItem => ({
    itemKey,
    kind: "task",
    label: itemKey,
    page: "plan",
    status: closed ? "done" : "todo",
    closed,
    due
  });

  it("puts overdue first, then open by date, then closed", () => {
    const sorted = sortAssigned(
      [
        item("done-early", "2026-09-01", true),
        item("undated", null),
        item("later", "2026-11-01"),
        item("overdue-recent", "2026-10-01"),
        item("sooner", "2026-10-10"),
        item("overdue-oldest", "2026-09-15")
      ],
      "2026-10-06"
    );
    expect(sorted.map((i) => i.itemKey)).toEqual([
      "overdue-oldest",
      "overdue-recent",
      "sooner",
      "later",
      "undated",
      "done-early"
    ]);
  });

  it("keeps page order between items due on the same day", () => {
    const sorted = sortAssigned(
      [item("first", "2026-10-10"), item("second", "2026-10-10")],
      "2026-10-06"
    );
    expect(sorted.map((i) => i.itemKey)).toEqual(["first", "second"]);
  });
});
