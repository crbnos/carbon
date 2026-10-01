// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditConfig } from "./audit.config";

const migrations = fileURLToPath(
  new URL("../supabase/migrations/", import.meta.url)
);

function newestDefinition(signature: string) {
  for (const file of readdirSync(migrations).sort().reverse()) {
    const sql = readFileSync(`${migrations}${file}`, "utf8");
    if (sql.includes(signature)) return { file, sql };
  }
  throw new Error(`No migration defines ${signature}`);
}

describe("dispatch_event_batch", () => {
  // The trigger drops an UPDATE that changes only these columns before it is
  // queued, because the audit diff would discard it. A new definition forked
  // from an older one silently loses the filter, and a skip field added on one
  // side only makes the trigger and the handler disagree.
  it("ignores exactly the columns the audit diff skips", () => {
    const { file, sql } = newestDefinition(
      "CREATE OR REPLACE FUNCTION public.dispatch_event_batch()"
    );
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
