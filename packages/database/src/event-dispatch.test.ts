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
