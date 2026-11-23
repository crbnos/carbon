// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  applyRowEdit,
  applyRowEdits,
  editMatchesRow,
  pruneRowEdits,
  type RowEdits,
  tick
} from "./rowEdits";

type Line = { id: string; quantity: number; item?: { name: string } };

const byId = (row: Line) => row.id;
const rows: Line[] = [
  { id: "a", quantity: 1 },
  { id: "b", quantity: 2 }
];

describe("tick", () => {
  it("only goes up", () => {
    const first = tick();
    expect(tick()).toBeGreaterThan(first);
  });
});

describe("applyRowEdit", () => {
  it("returns a new row and leaves the row as it was", () => {
    const row = { id: "a", quantity: 1, item: { name: "Bolt" } };
    const edited = applyRowEdit(row, { quantity: 5, item_name: "Nut" });
    expect(edited).toEqual({ id: "a", quantity: 5, item: { name: "Nut" } });
    expect(row).toEqual({ id: "a", quantity: 1, item: { name: "Bolt" } });
  });

  it("writes a key with `_` as is when the row has that key", () => {
    expect(applyRowEdit({ unit_price: 1 }, { unit_price: 2 })).toEqual({
      unit_price: 2
    });
  });
});

describe("editMatchesRow", () => {
  it("is true only when the row holds every edited value", () => {
    const row = { id: "a", quantity: 5, item: { name: "Nut" } };
    expect(editMatchesRow(row, { quantity: 5, item_name: "Nut" })).toBe(true);
    expect(editMatchesRow(row, { quantity: 6 })).toBe(false);
  });
});

describe("applyRowEdits", () => {
  it("lays an edit over its row by id, wherever the row is", () => {
    const at = tick();
    const edits: RowEdits = { b: { values: { quantity: 9 }, at } };
    const moved = [rows[1]!, rows[0]!];
    expect(applyRowEdits(moved, edits, byId, at - 1)).toEqual([
      { id: "b", quantity: 9 },
      { id: "a", quantity: 1 }
    ]);
  });

  it("drops an edit once a load that started after it has finished", () => {
    const at = tick();
    const edits: RowEdits = { a: { values: { quantity: 9 }, at } };
    const syncedAt = tick();
    expect(applyRowEdits(rows, edits, byId, syncedAt)).toBe(rows);
  });

  it("keeps an edit over a load that started before it", () => {
    const syncedAt = tick();
    const edits: RowEdits = { a: { values: { quantity: 9 }, at: tick() } };
    expect(applyRowEdits(rows, edits, byId, syncedAt)[0]).toEqual({
      id: "a",
      quantity: 9
    });
  });

  it("returns the rows themselves when no edit applies", () => {
    expect(applyRowEdits(rows, {}, byId, 0)).toBe(rows);
  });
});

describe("pruneRowEdits", () => {
  it("drops an edit the row already holds, and a stale one", () => {
    const syncedAt = tick();
    const at = tick();
    const edits: RowEdits = {
      a: { values: { quantity: 1 }, at }, // the row holds it
      b: { values: { quantity: 7 }, at }, // still live
      c: { values: { quantity: 3 }, at: syncedAt - 1 } // before the load
    };
    expect(pruneRowEdits(edits, rows, byId, syncedAt)).toEqual({
      b: { values: { quantity: 7 }, at }
    });
  });

  it("keeps a live edit of a row that is not loaded", () => {
    const syncedAt = tick();
    const edits: RowEdits = { z: { values: { quantity: 1 }, at: tick() } };
    expect(pruneRowEdits(edits, rows, byId, syncedAt)).toBe(edits);
  });
});
