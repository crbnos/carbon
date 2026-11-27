// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIONS, MODULES, pageById } from "@carbon/database/access";
import { defineCheck, eachFile, type Violation } from "../../check";
import { blankComments } from "../../sources/comments";
import { migrations, moduleKeyTypescript } from "../../sources/inputs";
import { loadManagedFunctionFiles } from "../../sources/managed-functions";
import { nameParts, sqlFragments } from "../../sources/sql";
import { lineOf } from "../../sources/text";

/*
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
 * In SQL, it fails a `<module>_<action>` token in a managed function file and
 * in every migration not in `module-key-migrations.json` (see the note in
 * `rule()`). The SQL is parsed: it reads every string constant and every name
 * (a policy may be named after its key), with a name cut at 63 bytes as
 * Postgres stores it. A list, not a date: a branch opened earlier can land a
 * migration dated before the cutoff, and it is checked.
 *
 * It skips:
 * - portal keys: `get_customer_ids_with_customer_permission('parts_view')` and
 *   its supplier twin read a portal account's own keys in `userPermission`,
 *   which keep their names (the generated authz migrations carry them); the
 *   manifest writes them as `portal.customer(column, "parts_view")`.
 * - `pagesOf("<module>")`, which names every page of a module on purpose
 *   (navigation, a module's dashboard).
 * - `documents`: it is a module with one page whose id is the module's, so
 *   `documents_view` is a page key.
 * The module list is the registry's (`MODULES`), so a new module is checked.
 */
export const noModulePermissionKey = defineCheck({
  id: "no-module-permission-key",
  description:
    "Permission checks name a page (<module>.<page>_<action>, { page: Level }), never a module",
  provenance: {
    deprecates:
      "module permission keys (inventory_view, { inventory: Edit }, { view: inventory })",
    replacedBy:
      "page keys from the access registry (packages/database/src/access/pages)",
    // The last migration that may name a module key: it renames the storage
    // policies whose names held one.
    since: "20261110050010"
  },
  // Migrations first: the runner groups a check by its first input, so this
  // check runs on the worker that has already parsed their SQL.
  reads: {
    migrations,
    functions: loadManagedFunctionFiles,
    typescript: moduleKeyTypescript
  },
  rule() {
    /*
     * Every migration that existed when the cutoff was set (all dated at or
     * before it), plus migrations merged from main later that the generated
     * page-permissions migration, sorting after them, re-ships with page keys:
     * the only ones that may still name a module key. Add nothing else to it.
     *
     * Add a migration only when both are true:
     * 1. It already landed on main, so its history cannot be edited.
     * 2. The generated page-permissions migration sorts after it and re-ships
     *    its tables with page keys. Regenerate that migration in the same
     *    change.
     * A listed migration dated after the cutoff must be a generated authz
     * migration, and the test checks its header. `unshipped` in
     * `@carbon/database`'s `migration.test.ts` then proves the re-ship. The
     * first migrations added this way came from main #2179 (two dated before
     * the cutoff, from a branch opened earlier) and main #2190.
     */
    const listed: string[] = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../module-key-migrations.json"
        ),
        "utf8"
      )
    );
    const moduleKeyMigrations = new Set(listed);

    const names = MODULES.map((module) => module.id)
      .filter((id) => !pageById(id))
      .join("|");
    const actionNames = ACTIONS.join("|");

    const tsKey = new RegExp(
      String.raw`(["'\`])(?:${names})_(?:${actionNames})\1`,
      "g"
    );
    const sqlKey = new RegExp(
      String.raw`(?<![\w.])(?:${names})_(?:${actionNames})\b`,
      "g"
    );
    const portalRule =
      /\bportal\.(?:customer|supplier)\s*\(\s*(["'`])\w+\1\s*,\s*(["'`])\w+\2/g;
    // Every page of the module: `anyOf(pagesOf("sales"), "View")`.
    const pagesOfCall = /\bpagesOf\s*\(\s*(["'`])\w+\1\s*\)/g;
    const gateOpener =
      /\b(?:authorize|authorizePanel|has|can|hasPermission|holdsGate)\s*\(|\bpermission\s*:/g;
    // A module as an object key, or a string that is exactly a module.
    const gateModule = new RegExp(
      String.raw`(?<![\w.$"'\`])(["']?)(${names})\1\s*:|(["'\`])(${names})\3`,
      "g"
    );

    /** The text from `from` up to its closing bracket, or to the end of the value. */
    const span = (text: string, from: number): string => {
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
    };

    const scanTypescript = (file: string, contents: string): Violation[] => {
      const text = blankComments(contents).replace(portalRule, (m) =>
        " ".repeat(m.length)
      );
      const violations: Violation[] = [];
      const seen = new Set<number>();
      const push = (index: number, snippet: string, message: string) => {
        if (seen.has(index)) return;
        seen.add(index);
        violations.push({ file, line: lineOf(text, index), snippet, message });
      };
      for (const m of text.matchAll(tsKey)) {
        push(
          m.index,
          m[0],
          `${m[0]} is a module key: it passes only with a module grant. Name the page's key, <module>.<page>_<action>.`
        );
      }
      for (const opener of text.matchAll(gateOpener)) {
        const start = opener.index + opener[0].length;
        const body = span(
          text,
          opener[0].endsWith("(") ? start - 1 : start
        ).replace(pagesOfCall, (m) => " ".repeat(m.length));
        for (const m of body.matchAll(gateModule)) {
          push(
            start + m.index,
            m[0],
            `A gate names a page, not the module "${m[2] ?? m[4]}": { "<module>.<page>": "<Level>" }, or { page, action } in the workflow catalog.`
          );
        }
      }
      return violations;
    };

    /** The portal functions: their argument is a portal account's own key, which keeps its name. */
    const portalFunctions = new Set([
      "get_customer_ids_with_customer_permission",
      "get_supplier_ids_with_supplier_permission"
    ]);

    /** `get_customer_ids_with_customer_permission(…)` or its supplier twin. */
    const isPortalCall = (tree: object): boolean => {
      if (!("FuncCall" in tree)) return false;
      const call = tree.FuncCall;
      if (call === null || typeof call !== "object" || !("funcname" in call)) {
        return false;
      }
      const funcname = Array.isArray(call.funcname) ? call.funcname : [];
      return portalFunctions.has(nameParts(funcname).at(-1) ?? "");
    };

    /** A function's or DO block's `AS '…'`: its source text. */
    const isBodySource = (tree: object): boolean => {
      if (!("DefElem" in tree)) return false;
      const option = tree.DefElem;
      return (
        option !== null &&
        typeof option === "object" &&
        "defname" in option &&
        option.defname === "as"
      );
    };

    type SqlKey = { key: string; location: number | undefined };

    /**
     * Every module key under `tree`: in a string constant, or in a name (a
     * policy may be named after the key it checks). A function body's source
     * is skipped: its SQL is read as a fragment of its own.
     */
    const sqlKeysIn = (
      tree: unknown,
      location: number | undefined,
      out: SqlKey[]
    ): SqlKey[] => {
      if (typeof tree === "string") {
        for (const m of tree.matchAll(sqlKey))
          out.push({ key: m[0], location });
        return out;
      }
      if (Array.isArray(tree)) {
        for (const item of tree) sqlKeysIn(item, location, out);
        return out;
      }
      if (tree === null || typeof tree !== "object") return out;
      if (isPortalCall(tree) || isBodySource(tree)) return out;
      const fields: { location?: unknown } = tree;
      const here =
        typeof fields.location === "number" ? fields.location : location;
      for (const value of Object.values(tree)) sqlKeysIn(value, here, out);
      return out;
    };

    const scanSql = (file: string, contents: string): Violation[] => {
      const base = file.split("/").pop() ?? file;
      const migration = /^\d{14}_/.test(base);
      if (migration && moduleKeyMigrations.has(base)) return [];
      if (!migration && !file.startsWith("packages/database/src/")) return [];
      const violations: Violation[] = [];
      for (const fragment of sqlFragments(contents)) {
        for (const statement of fragment.statements) {
          for (const { key, location } of sqlKeysIn(
            statement.node,
            undefined,
            []
          )) {
            violations.push({
              file,
              line:
                location === undefined
                  ? statement.line
                  : fragment.lineAt(location),
              snippet: key,
              message: `${key} is a module key: it passes only with a module grant. Check the page's key, <module>.<page>_<action>.`
            });
          }
        }
      }
      return violations;
    };

    return ({ migrations, functions, typescript }) =>
      eachFile([...migrations, ...functions, ...typescript], (file, contents) =>
        file.endsWith(".sql")
          ? scanSql(file, contents)
          : scanTypescript(file, contents)
      );
  }
});
