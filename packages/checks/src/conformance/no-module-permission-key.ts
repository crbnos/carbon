// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIONS, MODULES, pageById } from "@carbon/database/access";
import type { ConformanceCheck, Violation } from "../check";
import { blankComments, blankSqlComments } from "../sources/comments";

/**
 * Phase 3 of page-level permissions: no module key decides access. A module
 * key (`inventory_view`, `{ inventory: "Edit" }`) passes only with a module
 * grant, so a person who holds page grants alone is refused there. Every check
 * names a page instead: `inventory.receipts_view`, `{ "inventory.receipts":
 * "Edit" }` (`packages/database/src/access/pages`).
 *
 * It fails, in TypeScript (comments blanked):
 * - a `"<module>_<action>"` string literal;
 * - a module as a key or a string inside a gate: the arguments of `authorize`,
 *   `authorizePanel`, `has`, `can`, `hasPermission`, `holdsGate`, and the value
 *   of a `permission:` property (service functions and the workflow catalog,
 *   whose permissions are `{ page, action }`). That covers `{ inventory:
 *   "Edit" }`, the old `{ view: "inventory" }` and `{ module: "inventory" }`.
 * In SQL (comments blanked), it fails a `<module>_<action>` token in a managed
 * function file and in every migration not in `module-key-migrations.json`:
 * the frozen list of migrations that existed when the cutoff
 * (`LAST_MODULE_KEY_MIGRATION`) was set. A list, not a date: a branch opened
 * earlier can land a migration dated before the cutoff, and it is checked.
 *
 * It skips:
 * - portal keys: `get_customer_ids_with_customer_permission('parts_view')` and
 *   its supplier twin read a portal account's own keys in `userPermission`,
 *   which keep their names (the generated authz migrations carry them); the
 *   manifest writes them as `portal.customer(column, "parts_view")`.
 * - `hasAny` and `pagesOf("<module>")`, which name every page of
 *   a module on purpose (navigation, a module's dashboard).
 * - `documents`: it is a module with one page whose id is the module's, so
 *   `documents_view` is a page key.
 * The module list is the registry's (`MODULES`), so a new module is checked.
 */
const MODULE_IDS = MODULES.map((module) => module.id).filter(
  (id) => !pageById(id)
);
const NAMES = MODULE_IDS.join("|");
const ACTION_NAMES = ACTIONS.join("|");

/** The last migration that may name a module key: it renames the storage policies whose names held one. */
export const LAST_MODULE_KEY_MIGRATION = "20261110050010";

/**
 * Every migration that existed when the cutoff was set (all dated at or before
 * it), plus migrations merged from main later that the generated
 * page-permissions migration, sorting after them, re-ships with page keys: the
 * only ones that may still name a module key. Add nothing else to it.
 */
export const MODULE_KEY_MIGRATIONS: ReadonlySet<string> = new Set(
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "module-key-migrations.json"
      ),
      "utf8"
    )
  ) as string[]
);

const TS_KEY = new RegExp(
  String.raw`(["'\`])(?:${NAMES})_(?:${ACTION_NAMES})\1`,
  "g"
);
const SQL_KEY = new RegExp(
  String.raw`(?<![\w.])(?:${NAMES})_(?:${ACTION_NAMES})\b`,
  "g"
);
const PORTAL_CALL =
  /\bget_(?:customer|supplier)_ids_with_(?:customer|supplier)_permission\s*\(\s*'+\w+'+/g;
const PORTAL_RULE =
  /\bportal\.(?:customer|supplier)\s*\(\s*(["'`])\w+\1\s*,\s*(["'`])\w+\2/g;
// Every page of the module: `anyOf(pagesOf("sales"), "View")`.
const PAGES_OF_CALL = /\bpagesOf\s*\(\s*(["'`])\w+\1\s*\)/g;
const GATE_OPENER =
  /\b(?:authorize|authorizePanel|has|can|hasPermission|holdsGate)\s*\(|\bpermission\s*:/g;
// A module as an object key, or a string that is exactly a module.
const GATE_MODULE = new RegExp(
  String.raw`(?<![\w.$"'\`])(["']?)(${NAMES})\1\s*:|(["'\`])(${NAMES})\3`,
  "g"
);

/** The text from `from` up to its closing bracket, or to the end of the value. */
function span(text: string, from: number): string {
  let depth = 0;
  let i = from;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth <= 1) return text.slice(from, i + 1);
      depth--;
    } else if (depth === 0 && (ch === "," || ch === ";" || ch === "\n"))
      return text.slice(from, i);
  }
  return text.slice(from);
}

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

function scanTypescript(file: string, contents: string): Violation[] {
  const text = blankComments(contents).replace(PORTAL_RULE, (m) =>
    " ".repeat(m.length)
  );
  const violations: Violation[] = [];
  const seen = new Set<number>();
  const push = (index: number, snippet: string, message: string) => {
    if (seen.has(index)) return;
    seen.add(index);
    violations.push({ file, line: lineOf(text, index), snippet, message });
  };
  for (const m of text.matchAll(TS_KEY)) {
    push(
      m.index,
      m[0],
      `${m[0]} is a module key: it passes only with a module grant. Name the page's key, <module>.<page>_<action>.`
    );
  }
  for (const opener of text.matchAll(GATE_OPENER)) {
    const start = opener.index + opener[0].length;
    const body = span(
      text,
      opener[0].endsWith("(") ? start - 1 : start
    ).replace(PAGES_OF_CALL, (m) => " ".repeat(m.length));
    for (const m of body.matchAll(GATE_MODULE)) {
      push(
        start + m.index,
        m[0],
        `A gate names a page, not the module "${m[2] ?? m[4]}": { "<module>.<page>": "<Level>" }, or { page, action } in the workflow catalog.`
      );
    }
  }
  return violations;
}

function scanSql(file: string, contents: string): Violation[] {
  const base = file.split("/").pop() ?? file;
  const migration = /^\d{14}_/.test(base);
  if (migration && MODULE_KEY_MIGRATIONS.has(base)) return [];
  if (!migration && !file.startsWith("packages/database/src/")) return [];
  const sql = blankSqlComments(contents).replace(PORTAL_CALL, (m) =>
    " ".repeat(m.length)
  );
  return [...sql.matchAll(SQL_KEY)].map((m) => ({
    file,
    line: lineOf(sql, m.index),
    snippet: m[0],
    message: `${m[0]} is a module key: it passes only with a module grant. Check the page's key, <module>.<page>_<action>.`
  }));
}

export const noModulePermissionKey: ConformanceCheck = {
  id: "no-module-permission-key",
  description:
    "Permission checks name a page (<module>.<page>_<action>, { page: Level }), never a module",
  provenance: {
    deprecates:
      "module permission keys (inventory_view, { inventory: Edit }, { view: inventory })",
    replacedBy:
      "page keys from the access registry (packages/database/src/access/pages)",
    since: LAST_MODULE_KEY_MIGRATION
  },
  scan(file, contents) {
    if (file.endsWith(".sql")) return scanSql(file, contents);
    return scanTypescript(file, contents);
  }
};

/** Where module keys are looked for in TypeScript: every gate and client check, and the workflow engine. */
export const MODULE_KEY_ROOTS = [
  "apps/erp/app/components",
  "apps/erp/app/hooks",
  "apps/erp/app/modules",
  "apps/erp/app/routes",
  "apps/mes/app",
  "apps/academy/app",
  "apps/starter/app",
  "packages/database/src/authz",
  "packages/ee/src/workflows",
  "packages/jobs/src/workflows"
];
