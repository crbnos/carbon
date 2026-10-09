// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditConfig } from "./audit.config";

// Every trigger function that drops an UPDATE touching only bookkeeping columns.
const files = [
  "dispatch_event_batch",
  "broadcast_table_changes",
  "broadcast_user_changes",
  "broadcast_reference_changes",
  "log_table_changes",
  "log_user_changes"
].map((name) => `event-system/functions/${name}.sql`);

describe.each(files)("%s", (file) => {
  const sql = readFileSync(
    fileURLToPath(new URL(file, import.meta.url)),
    "utf8"
  );

  // The trigger drops an UPDATE that changes only these columns before it is
  // queued or broadcast, because the audit diff would discard it. A skip field
  // added on one side only makes the triggers and the handler disagree.
  it("ignores exactly the columns the audit diff skips", () => {
    const declared = sql.match(
      /ignored_columns CONSTANT TEXT\[\] := ARRAY\[([^\]]*)\]/
    );

    expect(declared, `${file} has no ignored_columns`).not.toBeNull();
    const columns = declared![1]!
      .split(",")
      .map((column) => column.trim().replace(/'/g, ""));
    expect(columns.sort()).toEqual([...auditConfig.skipFields].sort());
  });
});

describe("dispatch_event_batch recordId", () => {
  const read = (name: string) =>
    readFileSync(
      fileURLToPath(
        new URL(`event-system/functions/${name}.sql`, import.meta.url)
      ),
      "utf8"
    );

  // Behaviour is proven against a database, for every evented table, by
  // supabase/tests/event-record-id.test.sql. These keep the two edits that
  // test depends on from being reverted where no database runs.
  it("is built from the whole primary key, not one column of it", () => {
    const sql = read("dispatch_event_batch");
    expect(sql).toContain("pk_columns := public.get_primary_key_columns(");
    expect(sql.match(/''recordId'', %s,/g)).toHaveLength(3);
    expect(sql).toContain("IF 'id' = ANY(pk_columns)");
  });

  it("reads a unique index's key columns from position 0", () => {
    const sql = read("get_primary_key_columns");
    expect(sql).toContain("[0:i.indnkeyatts - 1]");
    expect(sql).not.toContain("[1:i.indnkeyatts]");
  });
});
