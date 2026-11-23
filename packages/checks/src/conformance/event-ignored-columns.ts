// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

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
    const declared =
      /ignored_columns\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i.exec(
        contents
      );
    if (!declared) continue;
    const columns = [...(declared[1] ?? "").matchAll(/'([^']+)'/g)]
      .map((m) => m[1] as string)
      .sort();
    if (columns.join() === expected.join()) continue;
    out.push({
      file,
      line: contents.slice(0, declared.index).split("\n").length,
      snippet: `ignored_columns ${columns.join(",")}`,
      message: `ignored_columns must equal auditConfig.skipFields (${expected.join(", ")})`
    });
  }
  return out;
}
