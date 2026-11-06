// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  collectValues,
  documentValues,
  rewriteValueEditRowKeys,
  setValueEdit
} from "./values";

describe("documentValues", () => {
  const edits = {
    document: { "order.date": "Soon" },
    rows: { "line:a": { "line.details": "Smallsat Bus Loaner" } }
  };

  it("applies a change to the document and to one row only", () => {
    const values = documentValues(edits);
    expect(
      values.document({ "order.date": "Jun 1", "order.id": "PO-1" })
    ).toEqual({ "order.date": "Soon", "order.id": "PO-1" });
    expect(values.row("line", "a", { "line.details": "Old" })).toEqual({
      "line.details": "Smallsat Bus Loaner"
    });
    expect(values.row("line", "b", { "line.details": "Old" })).toEqual({
      "line.details": "Old"
    });
  });

  it("reports the record's values, not the changed ones", () => {
    const { collector, collected } = collectValues();
    const values = documentValues(edits, collector);
    values.document({ "order.date": "Jun 1" });
    values.row("line", "a", { "line.details": "Old" });
    expect(collected).toEqual({
      document: { "order.date": "Jun 1" },
      rows: [
        { key: "line:a", prefix: "line", values: { "line.details": "Old" } }
      ]
    });
  });

  it("keeps the first of a repeated page", () => {
    const { collector, collected } = collectValues();
    const values = documentValues(undefined, collector);
    values.document({ "job.dueDate": "First" });
    values.document({ "job.dueDate": "Second" });
    values.row("line", "a", { "line.details": "One" });
    values.row("line", "a", { "line.details": "Two" });
    expect(collected.document["job.dueDate"]).toBe("First");
    expect(collected.rows).toHaveLength(1);
  });
});

describe("setValueEdit", () => {
  const row = { rowKey: "line:a", token: "line.details", recordValue: "Old" };

  it("adds a change and leaves nothing when typed back", () => {
    const changed = setValueEdit(undefined, row, "New");
    expect(changed).toEqual({ rows: { "line:a": { "line.details": "New" } } });
    expect(setValueEdit(changed, row, "Old")).toBeUndefined();
  });

  it("keeps the other changes", () => {
    const changed = setValueEdit(
      { document: { "order.date": "Soon" } },
      row,
      "New"
    );
    expect(changed).toEqual({
      document: { "order.date": "Soon" },
      rows: { "line:a": { "line.details": "New" } }
    });
    const document = setValueEdit(
      changed,
      { rowKey: null, token: "order.date", recordValue: "Soon" },
      "Soon"
    );
    expect(document).toEqual({ rows: { "line:a": { "line.details": "New" } } });
  });

  it("treats an emptied value as a change", () => {
    expect(setValueEdit(undefined, row, "")).toEqual({
      rows: { "line:a": { "line.details": "" } }
    });
  });
});

describe("rewriteValueEditRowKeys", () => {
  const edits = {
    document: { "order.date": "Soon" },
    rows: {
      "line:a": { "line.details": "One" },
      "charge:a:10:setup": { "charge.description": "Two" },
      "line:gone": { "line.details": "Three" }
    }
  };

  it("follows each id to its copy and drops a row with none", () => {
    const newId = new Map([["a", "z"]]);
    expect(rewriteValueEditRowKeys(edits, (id) => newId.get(id))).toEqual({
      document: { "order.date": "Soon" },
      rows: {
        "line:z": { "line.details": "One" },
        "charge:z:10:setup": { "charge.description": "Two" }
      }
    });
  });

  it("does not print another row's value when a null id has no key", () => {
    const row = documentValues({
      rows: { "line:null": { "line.details": "X" } }
    }).row("line", null, { "line.details": "Own" });
    expect(row).toEqual({ "line.details": "Own" });
  });
});
