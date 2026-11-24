// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPageModule,
  moduleEnum,
  moduleOf,
  ownersOf
} from "@carbon/database/access";
import type { SourceFile, Violation } from "../check";

export const MOVED_TABLES_COVERED = "moved-tables-covered";

const PAGES_DIR = "packages/database/src/access/pages";

/** The modules a table's policies checked before page permissions: module ids, as `inventory`. */
export type BaseModules = { read: readonly string[]; write: readonly string[] };

/**
 * Per table, the modules whose keys its SELECT (`read`) and its writes (`write`)
 * checked in the manifest on main before page permissions (a0d1fa4279). Frozen:
 * every later move is measured against it, so never regenerate or edit it.
 */
export const BASE_TABLE_MODULES: Readonly<Record<string, BaseModules>> =
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "base-table-modules.json"),
      "utf8"
    )
  );

/** A table's live policies: the command (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `ALL`) and its SQL. */
export type LivePolicy = { command: string; sql: string };

const POLICY =
  /CREATE POLICY\s+"[^"]*"\s+ON\s+(?:"?public"?\.)?"(\w+)"\s+(?:AS\s+\w+\s+)?FOR\s+(\w+)[^;]*;/g;

/**
 * Each table's policies as the migrations leave them: a migration that creates
 * any policy on a table replaces the whole set (a generated block drops them
 * all first). `migrations` must be in apply order.
 */
export function livePolicies(
  migrations: readonly SourceFile[]
): Map<string, LivePolicy[]> {
  const live = new Map<string, LivePolicy[]>();
  for (const migration of migrations) {
    const found = new Map<string, LivePolicy[]>();
    for (const match of migration.contents.matchAll(POLICY)) {
      const [sql, table, command] = match as unknown as [
        string,
        string,
        string
      ];
      found.set(table, [
        ...(found.get(table) ?? []),
        { command: command.toUpperCase(), sql }
      ]);
    }
    for (const [table, policies] of found) live.set(table, policies);
  }
  return live;
}

/** The registry facts the check needs; `REGISTRY` is the real one. */
export type MovedTablesRegistry = {
  /** The table's page, or every branch's page for a shared table or a child; empty when no page lists it. */
  ownersOf(table: string): readonly string[];
  /** The module id of a page: `inventory.receipts` → `inventory`. */
  moduleOf(page: string): string;
  /** False for a module with no pages (`printing`): its grants were moved in place. */
  hasPages(module: string): boolean;
};

export const REGISTRY: MovedTablesRegistry = {
  ownersOf,
  moduleOf,
  hasPages: (module) => isPageModule(moduleEnum(module as never))
};

const label = (module: string) => moduleEnum(module as never);

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
  registry: MovedTablesRegistry = REGISTRY,
  base: Readonly<Record<string, BaseModules>> = BASE_TABLE_MODULES
): Violation[] {
  const violations: Violation[] = [];
  for (const [table, before] of Object.entries(base)) {
    const owners = registry.ownersOf(table);
    if (owners.length === 0) continue;
    const now = new Set(owners.map((owner) => registry.moduleOf(owner)));
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
        file: `${PAGES_DIR}/${registry.moduleOf(owners[0] as string)}.ts`,
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
