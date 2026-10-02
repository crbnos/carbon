// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditConfig } from "./audit.config";

const file = "event-system/functions/dispatch_event_batch.sql";
const sql = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

describe("dispatch_event_batch", () => {
  // The trigger drops an UPDATE that changes only these columns before it is
  // queued, because the audit diff would discard it. A skip field added on one
  // side only makes the trigger and the handler disagree.
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
