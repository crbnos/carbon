// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The order drawers' saved-cell overlay and their read-only rows for actions
// whose order is not listed.

import { describe, expect, it } from "vitest";
import {
  withEdits,
  withOrphanActionRows
} from "../app/modules/production/ui/Planning/useDrawerOrders";

type Row = { id: string; quantity: number; dueDate: string | null };

const rows: Row[] = [
  { id: "a", quantity: 5, dueDate: "2026-11-02" },
  { id: "b", quantity: 7, dueDate: "2026-11-09" }
];

describe("withEdits", () => {
  it("is the rows themselves when nothing is edited", () => {
    expect(withEdits(rows, null, (row) => row.id)).toBe(rows);
  });

  // An edited row stays where it is until the read that follows it: a row
  // moving under the cursor while the planner tabs on would edit the wrong
  // order.
  it("keeps an edited row in place, even when its new date sorts later", () => {
    const edits = new Map([["a", { quantity: 9, dueDate: "2026-12-01" }]]);
    expect(withEdits(rows, edits, (row) => row.id)).toEqual([
      { id: "a", quantity: 9, dueDate: "2026-12-01" },
      { id: "b", quantity: 7, dueDate: "2026-11-09" }
    ]);
  });

  it("ignores an edit of a row the answer no longer has", () => {
    const edits = new Map([["gone", { quantity: 1, dueDate: null }]]);
    expect(withEdits(rows, edits, (row) => row.id)).toEqual(rows);
  });
});

type ActionRow = { id: string; action: { id: string } | null };

describe("withOrphanActionRows", () => {
  const toRow = (action: { id: string }): ActionRow => ({
    id: `orphan:${action.id}`,
    action
  });

  it("adds a row for each action no listed order carries, once", () => {
    const listed: ActionRow[] = [
      { id: "pol1", action: { id: "act1" } },
      { id: "pol2", action: null }
    ];
    expect(
      withOrphanActionRows(
        listed,
        [{ id: "act1" }, { id: "act2" }, { id: "act2" }],
        toRow
      )
    ).toEqual([
      { id: "pol1", action: { id: "act1" } },
      { id: "pol2", action: null },
      { id: "orphan:act2", action: { id: "act2" } }
    ]);
  });

  it("leaves the rows alone when every action has its order", () => {
    const listed: ActionRow[] = [{ id: "pol1", action: { id: "act1" } }];
    expect(withOrphanActionRows(listed, [{ id: "act1" }], toRow)).toEqual(
      listed
    );
  });
});
