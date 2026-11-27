// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile } from "../check";
import { sqlNodes } from "./sql";

/** A table's live policies: the command (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `ALL`) and its SQL. */
export type LivePolicy = { command: string; sql: string };

/**
 * Each table's policies as the migrations leave them: a migration that creates
 * any policy on a table replaces the whole set (a generated block drops them
 * all first). `migrations` must be in apply order. Only tables in "public" are
 * read; a policy with no FOR clause is for ALL.
 */
export function livePolicies(
  migrations: readonly SourceFile[]
): Map<string, LivePolicy[]> {
  const live = new Map<string, LivePolicy[]>();
  for (const migration of migrations) {
    const found = new Map<string, LivePolicy[]>();
    for (const { node, statement } of sqlNodes(migration.contents)) {
      if (!("CreatePolicyStmt" in node)) continue;
      const { table, cmd_name = "all" } = node.CreatePolicyStmt;
      const schema = table?.schemaname ?? "public";
      if (schema !== "public" || !table?.relname) continue;
      found.set(table.relname, [
        ...(found.get(table.relname) ?? []),
        { command: cmd_name.toUpperCase(), sql: statement.text }
      ]);
    }
    for (const [table, policies] of found) live.set(table, policies);
  }
  return live;
}
