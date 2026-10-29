// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AuditLogEntry } from "@carbon/database/audit.types";
import { describe, expect, it } from "vitest";
import { type AuditLogCsvLabels, buildAuditLogCsvRows } from "./utils";

const labels: AuditLogCsvLabels = {
  columns: {
    date: "Date",
    changedBy: "Changed By",
    action: "Action",
    record: "Record",
    recordId: "Record ID",
    field: "Field",
    oldValue: "Old Value",
    newValue: "New Value"
  },
  actions: { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" },
  system: "System"
};

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: "aud_1",
    companyId: "c1",
    tableName: "changeOrder",
    entityType: "changeOrder",
    entityId: "co_1",
    recordId: "co_1",
    operation: "UPDATE",
    actorId: "u1",
    diff: null,
    metadata: null,
    createdAt: "2026-10-08T10:00:00Z",
    ...overrides
  } as AuditLogEntry;
}

const build = (entries: AuditLogEntry[]) =>
  buildAuditLogCsvRows(entries, {
    labels,
    nameById: new Map([["u1", "Ada Lovelace"]]),
    getRecordLabel: (table) => `label:${table}`
  });

describe("buildAuditLogCsvRows", () => {
  it("gives one row per changed field", () => {
    const rows = build([
      entry({
        diff: {
          status: { old: "Start", new: "Engineering Complete" },
          dueDate: { old: null, new: "2026-10-20" }
        }
      })
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      Date: "2026-10-08T10:00:00Z",
      "Changed By": "Ada Lovelace",
      Action: "Updated",
      Record: "label:changeOrder",
      "Record ID": "co_1",
      Field: "status",
      "Old Value": "Start",
      "New Value": "Engineering Complete"
    });
    expect(rows[1]).toMatchObject({
      Field: "dueDate",
      "Old Value": "",
      "New Value": "2026-10-20"
    });
  });

  it("gives one row with empty field cells when nothing changed", () => {
    const rows = build([entry({ operation: "DELETE", diff: {} })]);

    expect(rows).toEqual([
      expect.objectContaining({
        Action: "Deleted",
        Field: "",
        "Old Value": "",
        "New Value": ""
      })
    ]);
  });

  it("names system changes and keeps an unknown actor's id", () => {
    const rows = build([
      entry({ actorId: null, diff: {} }),
      entry({ actorId: "system", diff: {} }),
      entry({ actorId: "u-gone", diff: {} })
    ]);

    expect(rows.map((r) => r["Changed By"])).toEqual([
      "System",
      "System",
      "u-gone"
    ]);
  });

  it("writes numbers, booleans and objects as text", () => {
    const rows = build([
      entry({
        diff: {
          quantity: { old: 1, new: 2.5 },
          active: { old: false, new: true },
          tags: { old: [], new: ["a"] }
        }
      })
    ]);

    expect(rows.map((r) => [r["Old Value"], r["New Value"]])).toEqual([
      ["1", "2.5"],
      ["false", "true"],
      ["[]", '["a"]']
    ]);
  });
});
