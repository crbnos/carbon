// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";
import { nodesIn, sqlFragments } from "../sources/sql";

export const EVENT_IGNORED_COLUMNS = "event-ignored-columns";

export const EVENT_FUNCTIONS_DIR =
  "packages/database/src/event-system/functions";
export const AUDIT_CONFIG_FILE = "packages/database/src/audit.config.ts";

/**
 * The event triggers drop an UPDATE that changes only bookkeeping columns
 * before it is queued, broadcast or logged, because the audit diff would
 * discard it anyway (`auditConfig.skipFields`). A column added on one side
 * only makes the triggers and the handler disagree.
 */
export function findIgnoredColumnDrift(
  functions: SourceFile[],
  auditConfig: SourceFile
): Violation[] {
  const skip = /skipFields:\s*\[([^\]]*)\]/.exec(auditConfig.contents)?.[1];
  if (skip === undefined) {
    return [
      {
        file: auditConfig.file,
        line: 0,
        snippet: "skipFields",
        message: "auditConfig.skipFields not found"
      }
    ];
  }
  const expected = [...skip.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1] as string)
    .sort();

  const out: Violation[] = [];
  for (const { file, contents } of functions) {
    // `ignored_columns CONSTANT TEXT[] := ARRAY['a', 'b']` in a DECLARE.
    const declared = sqlFragments(contents).find(
      (fragment) => fragment.variable === "ignored_columns"
    );
    const [statement] = declared?.statements ?? [];
    if (!statement) continue;
    const columns: string[] = [];
    for (const { node } of nodesIn(statement.node)) {
      const value = "A_Const" in node ? node.A_Const.sval?.sval : undefined;
      if (value !== undefined) columns.push(value);
    }
    columns.sort();
    if (columns.join() === expected.join()) continue;
    out.push({
      file,
      line: statement.line,
      snippet: `ignored_columns ${columns.join(",")}`,
      message: `ignored_columns must equal auditConfig.skipFields (${expected.join(", ")})`
    });
  }
  return out;
}
