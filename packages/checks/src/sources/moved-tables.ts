// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MODULES } from "@carbon/database/access";
import type { Violation } from "../check";
import type { LivePolicy } from "./rls-policies";

const PAGES_DIR = "packages/database/src/access/pages";

/** The modules a table's policies checked before page permissions: module ids, as `inventory`. */
export type BaseModules = { read: readonly string[]; write: readonly string[] };

/** The registry facts `findMovedTableGaps` needs. */
export type MovedTablesRegistry = {
  /** The table's page, or every branch's page for a shared table or a child; empty when no page lists it. */
  ownersOf(table: string): readonly string[];
  /** The module id of a page: `inventory.receipts` → `inventory`. */
  moduleOf(page: string): string;
  /** False for a module with no pages (`printing`): its grants were moved in place. */
  hasPages(module: string): boolean;
};

/** The `module` enum label of a module id: `inventory` → `Inventory`. */
const label = (module: string) =>
  MODULES.find((m) => m.id === module)?.enum ?? module;

/** A key of a page of `module` that a write checks: `'inventory.quantities_create'`. */
const writeKey = (module: string) =>
  new RegExp(String.raw`'${module}\.\w+_(?:create|update|delete)'`);
/** A read of `module`: one of its page keys, or the module in `get_companies_with_module_view`. */
const readKey = (module: string) =>
  new RegExp(String.raw`'${module}(?:'|\.\w+_(?:view|create|update|delete)')`);

/**
 * A table whose page is now in another module than one its policies checked
 * before page permissions keeps that module's holders: its live write policies
 * check a page of every old write module, and its SELECT admits every old read
 * module. Never through a page grant in the new module, which would read the
 * whole new module (RLS reads are module-wide); the registry way is the new
 * page's `alsoWrittenBy` and the old page's `readers`, or a page key in the
 * rule. Read off the live policies, so a rule, a registry entry or a generated
 * migration that drops the old holders fails here.
 *
 * Tables no page owns are skipped (gone from the schema, or not a page's).
 */
export function findMovedTableGaps(
  policies: ReadonlyMap<string, readonly LivePolicy[]>,
  registry: MovedTablesRegistry,
  base: Readonly<Record<string, BaseModules>>
): Violation[] {
  const violations: Violation[] = [];
  for (const [table, before] of Object.entries(base)) {
    const owners = registry.ownersOf(table);
    const [owner] = owners;
    if (owner === undefined) continue;
    const now = new Set(owners.map((page) => registry.moduleOf(page)));
    const left = (modules: readonly string[]) =>
      modules.filter((m) => !now.has(m) && registry.hasPages(m));
    const live = policies.get(table) ?? [];
    const sqlOf = (commands: string[]) =>
      live
        .filter((p) => commands.includes(p.command))
        .map((p) => p.sql)
        .join("\n");
    const writes = sqlOf(["INSERT", "UPDATE", "DELETE", "ALL"]);
    const reads = sqlOf(["SELECT", "ALL"]);
    const gap = (from: string, problem: string, fix: string) =>
      violations.push({
        file: `${PAGES_DIR}/${registry.moduleOf(owner)}.ts`,
        line: 0,
        snippet: table,
        message: `${table} moved from ${label(from)} to ${owners.join(", ")}, and ${problem} page of ${label(from)}: ${fix} a page of ${label(from)}, then run authz migration`
      });
    for (const from of left(before.write))
      if (!writeKey(from).test(writes))
        gap(
          from,
          "no write policy checks a",
          "list it in its page's alsoWrittenBy with"
        );
    for (const from of left(before.read))
      if (!readKey(from).test(reads))
        gap(from, "its SELECT admits no", "list it in the readers of");
  }
  return violations;
}
