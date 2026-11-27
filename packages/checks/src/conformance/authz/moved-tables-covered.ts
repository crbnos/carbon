// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULES, moduleOf, ownersOf } from "@carbon/database/access";
import { defineCheck, type Violation } from "../../check";
import { migrations } from "../../sources/inputs";
import { sqlNodes } from "../../sources/sql";

// A table whose page is now in another module than one its policies checked
// before page permissions keeps that module's holders: its live write policies
// check a page of every old write module, and its SELECT admits every old read
// module. Never through a page grant in the new module, which would read the
// whole new module (RLS reads are module-wide); the registry way is the new
// page's `alsoWrittenBy` and the old page's `readers`, or a page key in the
// rule. Read off the live policies, so a rule, a registry entry or a generated
// migration that drops the old holders fails here.
//
// Tables no page owns are skipped (gone from the schema, or not a page's).
export const movedTablesCovered = defineCheck({
  id: "moved-tables-covered",
  description:
    "A table whose page is now in another module than one its policies checked before page permissions keeps that module's holders.",
  reads: {
    migrations,
    // Per table, the modules whose keys its SELECT (`read`) and its writes
    // (`write`) checked in the manifest on main before page permissions
    // (a0d1fa4279). Frozen: every later move is measured against it, so never
    // regenerate or edit it.
    base: (
      root: string
    ): Readonly<
      Record<string, { read: readonly string[]; write: readonly string[] }>
    > =>
      JSON.parse(
        readFileSync(
          join(
            root,
            "packages/checks/src/conformance/authz/base-table-modules.json"
          ),
          "utf8"
        )
      ),
    registry: (): {
      /** The table's page, or every branch's page for a shared table or a child; empty when no page lists it. */
      ownersOf(table: string): readonly string[];
      moduleOf(page: string): string;
      /** False for a module with no pages (`printing`): its grants were moved in place. */
      hasPages(module: string): boolean;
      /** The `module` enum label of a module id: `inventory` → `Inventory`. */
      label(module: string): string;
    } => ({
      ownersOf,
      moduleOf,
      hasPages: (module) => MODULES.some((m) => m.id === module),
      label: (module) => MODULES.find((m) => m.id === module)?.enum ?? module
    })
  },
  rule() {
    const pagesDir = "packages/database/src/access/pages";

    /** A key of a page of `module` that a write checks: `'inventory.quantities_create'`. */
    const writeKey = (module: string) =>
      new RegExp(String.raw`'${module}\.\w+_(?:create|update|delete)'`);
    /** A read of `module`: one of its page keys, or the module in `get_companies_with_module_view`. */
    const readKey = (module: string) =>
      new RegExp(
        String.raw`'${module}(?:'|\.\w+_(?:view|create|update|delete)')`
      );

    type LivePolicy = { command: string; sql: string };

    /**
     * Each table's policies as the migrations leave them: a migration that
     * creates any policy on a table replaces the whole set (a generated block
     * drops them all first). Only tables in "public" are read; a policy with
     * no FOR clause is for ALL.
     */
    const livePolicies = (
      files: readonly { contents: string }[]
    ): Map<string, LivePolicy[]> => {
      const live = new Map<string, LivePolicy[]>();
      for (const migration of files) {
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
    };

    return ({ migrations, base, registry }) => {
      const policies = livePolicies(migrations);
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
        const gap = (from: string, problem: string, fix: string) => {
          const label = registry.label(from);
          violations.push({
            file: `${pagesDir}/${registry.moduleOf(owner)}.ts`,
            line: 0,
            snippet: table,
            message: `${table} moved from ${label} to ${owners.join(", ")}, and ${problem} page of ${label}: ${fix} a page of ${label}, then run authz migration`
          });
        };
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
    };
  }
});
