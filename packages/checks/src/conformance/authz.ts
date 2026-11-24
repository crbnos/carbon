// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIONS,
  ITEM_PAGES,
  isPageModule,
  MODULES,
  moduleEnum,
  moduleOf,
  ownersOf,
  PAGES,
  pageById,
  pageOfUrl,
  pagesOf,
  pagesOfUrl,
  routeUrl,
  urlCoverage,
  urlSegments
} from "@carbon/database/access";
import {
  REGISTRY_HELPERS_DIR,
  renderRegistryHelpers
} from "@carbon/database/authz-registry-sql";
import type { Node } from "libpg-query";
import ts from "typescript5";
import {
  type Check,
  type ConformanceCheck,
  eachFile,
  fileCheck,
  type SourceFile,
  type Violation
} from "../check";
import { loadRegistryHelperFiles } from "../sources/authz-registry";
import { blankComments } from "../sources/comments";
import { loadEdgeFunctions } from "../sources/edge-functions";
import { migrations, routeTypescript } from "../sources/inputs";
import { loadSqlFiles } from "../sources/migrations";
import { nameParts, sqlFragments, sqlNodes } from "../sources/sql";
import { lineOf } from "../sources/text";
import { loadTypescriptFiles } from "../sources/typescript";

/*
 * Who may do what. These checks keep access decisions where they are authored:
 * edge functions authorize their caller, policies and managed functions live in
 * files rather than migrations, every gate names a page and not a module, and
 * every ERP route belongs to the page its gate names.
 */

// --- edge-function-authorizes-caller ---

/**
 * The gates each self-contained edge function defines for itself. Each one
 * throws for the bare anon key, which verify_jwt alone lets through: it is a
 * validly signed JWT, and the apps publish it in their HTML.
 *
 * A function passes only when it calls one of them; the declaration alone
 * does not count. The call may be in any of the function's own `.ts` files
 * (see `loadEdgeFunctions`).
 */
const AUTH_CALL = /(?<!function\s+)\b(requireCaller|requireServiceRole)\s*\(/;

export const edgeFunctionAuthorizesCaller = fileCheck(loadEdgeFunctions, {
  id: "edge-function-authorizes-caller",
  description:
    "Every edge function authorizes its caller in-function (requireCaller / requireServiceRole).",
  provenance: {
    deprecates: "relying on verify_jwt, which accepts the published anon key",
    replacedBy: "requireCaller / requireServiceRole"
  },
  scan(file, contents) {
    const name = file.split("/").pop() ?? file;
    if (AUTH_CALL.test(contents)) return [];
    const violation: Violation = {
      file,
      line: 0,
      snippet: name,
      message:
        "No in-function authorization: verify_jwt accepts the anon key. Call requireCaller (signed-in users, API keys, servers) or requireServiceRole (servers only)."
    };
    return [violation];
  }
});

// --- registry-helpers-fresh ---

export const REGISTRY_HELPERS_FRESH = "registry-helpers-fresh";

export const REGISTRY_HELPERS_FIX = "pnpm --filter @carbon/database authz sync";

/**
 * The managed helpers whose bodies are the registry (every file
 * `renderRegistryHelpers()` renders) are written from `access/pages` by
 * `authz sync`. A page edit without a sync leaves the database answering from
 * the old registry.
 *
 * `rendered` is what each file must hold (`renderRegistryHelpers()` in
 * `@carbon/database/authz-registry-sql`); `files` is what the repo holds, a
 * missing file passed as `undefined` contents. Each file that differs fails.
 */
export function findStaleRegistryHelpers(
  rendered: readonly { name: string; sql: string }[],
  files: readonly { file: string; contents: string | undefined }[]
): Violation[] {
  const byFile = new Map(files.map((f) => [f.file, f.contents]));
  const violations: Violation[] = [];
  for (const { name, sql } of rendered) {
    const file = `${REGISTRY_HELPERS_DIR}/${name}`;
    const contents = byFile.get(file);
    if (contents === sql) continue;
    violations.push({
      file,
      line: 0,
      snippet: name,
      message:
        contents === undefined
          ? `${name} is missing: run ${REGISTRY_HELPERS_FIX}`
          : `${name} is stale (it differs from the registry): run ${REGISTRY_HELPERS_FIX}`
    });
  }
  return violations;
}

const registryHelpers = (root: string) => {
  const rendered = renderRegistryHelpers();
  return {
    rendered,
    files: loadRegistryHelperFiles(
      root,
      rendered.map((helper) => helper.name)
    )
  };
};

export const registryHelpersFresh: Check = {
  id: REGISTRY_HELPERS_FRESH,
  description:
    "The managed helpers whose bodies are the registry (every file `renderRegistryHelpers()` renders) are written from `access/pages` by `authz sync`.",
  find: (repo) => {
    const { rendered, files } = repo.read(registryHelpers);
    return findStaleRegistryHelpers(rendered, files);
  }
};

// --- no-authz-ddl-in-migrations ---

/**
 * RLS policies and the managed functions are authored only as files — the manifest and
 * packages/database/src/authz/helpers/<name>.sql for RLS, and
 * packages/database/src/event-system/functions/<name>.sql for the event system — and
 * `authz sync` applies them after migrations. A migration that creates or alters a policy,
 * or defines, alters or drops a managed function, would be silently overwritten at the next
 * sync — or reintroduce exactly the drift the files exist to stop (a redefinition once
 * turned get_companies_with_employee_permission from STABLE back to VOLATILE; a fork of
 * create_audit_log_table made every audit write run DDL).
 *
 * `DROP POLICY` stays allowed: dropping a column a policy uses needs the policy gone
 * first, and the next sync recreates the table's policies from the manifest.
 *
 * Only migrations after a set was taken over are checked; older ones are history.
 */
const SINCE = "20260927000000";
/** The migration that took over the event-system functions. */
const EVENT_SYSTEM_SINCE = "20261002114954";

/**
 * The migration that took over the table handlers (interceptors and statement
 * handlers) and the event triggers that attach them.
 */
const ATTACHMENTS_SINCE = "20261004194527";

/** The directories of managed function files, and the migration each set is checked from. */
export const MANAGED_FUNCTION_SETS = [
  { dir: REGISTRY_HELPERS_DIR, since: SINCE },
  {
    dir: "packages/database/src/event-system/functions",
    since: EVENT_SYSTEM_SINCE
  },
  {
    dir: "packages/database/src/event-system/handlers",
    since: ATTACHMENTS_SINCE
  }
];

// Each of these replaces a table's whole list of handlers, so a call that
// leaves one out detaches it. The lists live in one place instead:
// packages/database/src/event-system/attachments.ts.
const ATTACH_CALLS = new Set([
  "attach_event_trigger",
  "attach_statement_handler",
  "set_event_triggers"
]);

/** `file` is `<name>.sql` for public, `<schema>.<name>.sql` otherwise. */
export type ManagedFunction = {
  schema: string;
  name: string;
  /** Repo-relative path of the file that defines it. */
  file: string;
  since: string;
};

/**
 * The first line of a migration rendered from the manifest by `authz migration` — the WHOLE
 * line, equal to GENERATED_HEADER in packages/database/src/authz/migration.ts (pinned by this
 * check's test). Those files carry policy and helper DDL on purpose, and @carbon/database's
 * migration.test.ts verifies the contents of exactly the files that start with that full line.
 * Matching only a prefix here let a hand-written file with an edited suffix skip both.
 */
export const GENERATED_AUTHZ_MIGRATION =
  "-- Generated by `pnpm --filter @carbon/database authz migration` from packages/database/src/authz. Do not edit.";

// The manifest owns public tables and realtime.messages (broadcast authorization);
// storage.objects (bucket) policies stay in migrations.
const MANIFEST_SCHEMAS = new Set(["public", "realtime"]);

/** The function a statement defines, alters or drops, as `[schema, name]` parts. */
function functionsTouched(node: Node): { verb: string; parts: string[] }[] {
  if ("CreateFunctionStmt" in node) {
    const parts = nameParts(node.CreateFunctionStmt.funcname);
    return [{ verb: "CREATE FUNCTION", parts }];
  }
  if ("AlterFunctionStmt" in node) {
    const parts = nameParts(node.AlterFunctionStmt.func?.objname);
    return [{ verb: "ALTER FUNCTION", parts }];
  }
  const altered =
    "AlterOwnerStmt" in node &&
    node.AlterOwnerStmt.objectType === "OBJECT_FUNCTION"
      ? node.AlterOwnerStmt.object
      : "RenameStmt" in node && node.RenameStmt.renameType === "OBJECT_FUNCTION"
        ? node.RenameStmt.object
        : "AlterObjectSchemaStmt" in node &&
            node.AlterObjectSchemaStmt.objectType === "OBJECT_FUNCTION"
          ? node.AlterObjectSchemaStmt.object
          : undefined;
  if (altered && "ObjectWithArgs" in altered) {
    const parts = nameParts(altered.ObjectWithArgs.objname);
    return [{ verb: "ALTER FUNCTION", parts }];
  }
  if ("DropStmt" in node && node.DropStmt.removeType === "OBJECT_FUNCTION") {
    return (node.DropStmt.objects ?? []).flatMap((object) =>
      "ObjectWithArgs" in object
        ? [
            {
              verb: "DROP FUNCTION",
              parts: nameParts(object.ObjectWithArgs.objname)
            }
          ]
        : []
    );
  }
  return [];
}

/**
 * The managed functions: one `<name>.sql` (or `<schema>.<name>.sql`) file each.
 * The list is read from the directories, so it cannot drift from the files.
 */
export function loadManagedFunctions(root: string): ManagedFunction[] {
  return MANAGED_FUNCTION_SETS.flatMap(({ dir, since }) =>
    readdirSync(join(root, dir))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => {
        const [first = "", second] = file.replace(/\.sql$/, "").split(".");
        return {
          schema: second ? first : "public",
          name: second ?? first,
          file: `${dir}/${file}`,
          since
        };
      })
  );
}

/** The managed function files, read with their repo paths. */
export function loadManagedFunctionFiles(root: string): SourceFile[] {
  return MANAGED_FUNCTION_SETS.flatMap(({ dir }) =>
    loadSqlFiles(join(root, dir)).map(({ file, contents }) => ({
      file: `${dir}/${file}`,
      contents
    }))
  );
}

const AUTHZ_DDL_ABOUT = {
  id: "no-authz-ddl-in-migrations",
  description:
    "Policies, RLS helpers, event-system functions and event triggers are authored as files, not migrations.",
  provenance: {
    deprecates: "CREATE/ALTER POLICY and managed function DDL in migrations",
    replacedBy:
      "packages/database/src/authz (manifest.ts + helpers/*.sql) and packages/database/src/event-system/functions/*.sql",
    since: SINCE
  }
};

/** The check for a given set of managed functions: tests pass their own. */
export const noAuthzDdlInMigrations = (
  functions: ManagedFunction[]
): ConformanceCheck => ({
  ...AUTHZ_DDL_ABOUT,
  scan(file, contents) {
    const timestamp = /^(\d{14})_/.exec(file)?.[1];
    if (
      !timestamp ||
      timestamp < SINCE ||
      contents.startsWith(GENERATED_AUTHZ_MIGRATION)
    )
      return [];

    const managed = new Map(
      functions.map((f) => [`${f.schema}.${f.name}`.toLowerCase(), f])
    );
    const violations: Violation[] = [];
    for (const { node, line } of sqlNodes(contents)) {
      const policy =
        "CreatePolicyStmt" in node
          ? { verb: "CREATE", ...node.CreatePolicyStmt }
          : "AlterPolicyStmt" in node
            ? { verb: "ALTER", ...node.AlterPolicyStmt }
            : undefined;
      if (
        policy &&
        MANIFEST_SCHEMAS.has(policy.table?.schemaname ?? "public")
      ) {
        violations.push({
          file,
          line,
          snippet: `${policy.verb} POLICY "${policy.policy_name}" ON "${policy.table?.relname}"`,
          message:
            "Author policies in packages/database/src/authz/manifest.ts, then run `pnpm --filter @carbon/database authz migration <name>`."
        });
      }

      if ("FuncCall" in node && timestamp >= ATTACHMENTS_SINCE) {
        const called = nameParts(node.FuncCall.funcname).at(-1) ?? "";
        if (ATTACH_CALLS.has(called)) {
          violations.push({
            file,
            line,
            snippet: `${called}(`,
            message:
              "Declare event triggers in packages/database/src/event-system/attachments.ts, then run `pnpm --filter @carbon/database authz migration <name>`."
          });
        }
      }

      for (const { verb, parts } of functionsTouched(node)) {
        const name = parts.at(-1) ?? "";
        const schema = parts.length > 1 ? parts[0] : "public";
        const fn = managed.get(`${schema}.${name}`.toLowerCase());
        if (!fn || timestamp < fn.since) continue;
        violations.push({
          file,
          line,
          snippet: `${verb} ${name}`,
          message: `${name} is a managed function; edit ${fn.file}, then run \`pnpm --filter @carbon/database authz migration <name>\`.`
        });
      }
    }
    return violations;
  }
});

export const noAuthzDdlInMigrationsCheck: Check = {
  ...AUTHZ_DDL_ABOUT,
  find: (repo) =>
    eachFile(
      repo.read(migrations),
      noAuthzDdlInMigrations(repo.read(loadManagedFunctions)).scan
    )
};

// --- no-legacy-rls ---

export const noLegacyRls = fileCheck(migrations, {
  id: "no-legacy-rls",
  description:
    "Use get_companies_with_employee_permission(...), not has_role()/has_company_permission().",
  provenance: {
    deprecates: "has_company_permission()",
    replacedBy: "get_companies_with_employee_permission()",
    since: "20250201181148_rls-refactor.sql"
  },
  scan(file, contents) {
    // Rendered from packages/database/src/authz, which owns the deprecated helpers' own
    // definitions until they can be dropped.
    if (contents.startsWith(GENERATED_AUTHZ_MIGRATION)) return [];
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if (!("FuncCall" in node)) continue;
      const { funcname, location } = node.FuncCall;
      if (nameParts(funcname).at(-1) !== "has_company_permission") continue;
      violations.push({
        file,
        line: fragment.lineAt(location),
        snippet: "has_company_permission(",
        message:
          "Deprecated RLS helper; use get_companies_with_employee_permission()."
      });
    }
    return violations;
  }
});

// --- no-module-permission-key ---

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
 * In SQL, it fails a `<module>_<action>` token in a managed function file and
 * in every migration not in `MODULE_KEY_MIGRATIONS` (see its doc). The SQL is
 * parsed: it reads every string constant and every name (a policy may be named
 * after its key), with a name cut at 63 bytes as Postgres stores it. A list, not a date: a branch opened earlier can land a migration
 * dated before the cutoff, and it is checked.
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
 *
 * Add a migration only when both are true:
 * 1. It already landed on main, so its history cannot be edited.
 * 2. The generated page-permissions migration sorts after it and re-ships its
 *    tables with page keys. Regenerate that migration in the same change.
 * A listed migration dated after the cutoff must be a generated authz
 * migration, and the test checks its header. `unshipped` in
 * `@carbon/database`'s `migration.test.ts` then proves the re-ship. The first
 * migrations added this way came from main #2179 (two dated before the cutoff,
 * from a branch opened earlier) and main #2190.
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

/** The portal functions: their argument is a portal account's own key, which keeps its name. */
const PORTAL_FUNCTIONS = new Set([
  "get_customer_ids_with_customer_permission",
  "get_supplier_ids_with_supplier_permission"
]);

/** `get_customer_ids_with_customer_permission(…)` or its supplier twin. */
function isPortalCall(tree: object): boolean {
  if (!("FuncCall" in tree)) return false;
  const call = tree.FuncCall;
  if (call === null || typeof call !== "object" || !("funcname" in call)) {
    return false;
  }
  const names = Array.isArray(call.funcname) ? call.funcname : [];
  return PORTAL_FUNCTIONS.has(nameParts(names).at(-1) ?? "");
}

/** A function's or DO block's `AS '…'`: its source text. */
function isBodySource(tree: object): boolean {
  if (!("DefElem" in tree)) return false;
  const option = tree.DefElem;
  return (
    option !== null &&
    typeof option === "object" &&
    "defname" in option &&
    option.defname === "as"
  );
}

type SqlKey = { key: string; location: number | undefined };

/**
 * Every module key under `tree`: in a string constant, or in a name (a policy
 * may be named after the key it checks). A function body's source is skipped:
 * its SQL is read as a fragment of its own.
 */
function sqlKeysIn(
  tree: unknown,
  location: number | undefined,
  out: SqlKey[]
): SqlKey[] {
  if (typeof tree === "string") {
    for (const m of tree.matchAll(SQL_KEY)) out.push({ key: m[0], location });
    return out;
  }
  if (Array.isArray(tree)) {
    for (const item of tree) sqlKeysIn(item, location, out);
    return out;
  }
  if (tree === null || typeof tree !== "object") return out;
  if (isPortalCall(tree) || isBodySource(tree)) return out;
  const fields: { location?: unknown } = tree;
  const here = typeof fields.location === "number" ? fields.location : location;
  for (const value of Object.values(tree)) sqlKeysIn(value, here, out);
  return out;
}

function scanSql(file: string, contents: string): Violation[] {
  const base = file.split("/").pop() ?? file;
  const migration = /^\d{14}_/.test(base);
  if (migration && MODULE_KEY_MIGRATIONS.has(base)) return [];
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
            location === undefined ? statement.line : fragment.lineAt(location),
          snippet: key,
          message: `${key} is a module key: it passes only with a module grant. Check the page's key, <module>.<page>_<action>.`
        });
      }
    }
  }
  return violations;
}

export const noModulePermissionKey: ConformanceCheck & Check = {
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
  },
  find: (repo) =>
    eachFile(
      [
        ...repo.read(migrations),
        ...repo.read(loadManagedFunctionFiles),
        ...repo.read(moduleKeyTypescript)
      ],
      noModulePermissionKey.scan
    )
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

const moduleKeyTypescript = (root: string) =>
  loadTypescriptFiles(root, MODULE_KEY_ROOTS);

// --- moved-tables-covered ---

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

/** The registry facts the check needs; `MOVED_TABLES_REGISTRY` is the real one. */
export type MovedTablesRegistry = {
  /** The table's page, or every branch's page for a shared table or a child; empty when no page lists it. */
  ownersOf(table: string): readonly string[];
  /** The module id of a page: `inventory.receipts` → `inventory`. */
  moduleOf(page: string): string;
  /** False for a module with no pages (`printing`): its grants were moved in place. */
  hasPages(module: string): boolean;
};

export const MOVED_TABLES_REGISTRY: MovedTablesRegistry = {
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
  registry: MovedTablesRegistry = MOVED_TABLES_REGISTRY,
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

export const movedTablesCovered: Check = {
  id: MOVED_TABLES_COVERED,
  description:
    "A table whose page is now in another module than one its policies checked before page permissions keeps that module's holders.",
  find: (repo) => findMovedTableGaps(livePolicies(repo.read(migrations)))
};

// --- route-maps-to-page ---

export const ROUTE_MAPS_TO_PAGE = "route-maps-to-page";

/** The ERP route tree whose files the check maps to pages. */
export const ERP_ROUTES_DIR = "apps/erp/app/routes/x+";

const THIS_FILE = "packages/checks/src/conformance/authz.ts";

/**
 * The ERP route files under `x+` that `findRoutePageGaps` maps, relative to
 * `x+`: the files remix-flat-routes builds routes from (`apps/erp/app/routes.ts`
 * ignores dot folders, `__` names and `.server`/`.client`/`.test` files).
 */
export function loadErpRouteFiles(root: string): string[] {
  return (
    readdirSync(join(root, ERP_ROUTES_DIR), { recursive: true }) as string[]
  )
    .map((file) => file.split("\\").join("/"))
    .filter(
      (file) =>
        /\.(tsx?|jsx?)$/.test(file) &&
        !file.split("/").some((part) => part.startsWith(".")) &&
        !/(^|\/)__|\.(server|client|test)\./.test(file)
    )
    .sort();
}

/**
 * Routes under `x+` that belong to no one page, with the reason. A key that
 * ends with `/` covers its own URL and every route below it; any other key is
 * one route.
 */
export const UNPAGED_ROUTES: Readonly<Record<string, string>> = {
  "/x": "The app shell and the home page.",
  // Documents, Workflows, Projects and Service have a page at their root.
  ...Object.fromEntries(
    [
      "accounting",
      "inventory",
      "invoicing",
      "items",
      "people",
      "production",
      "purchasing",
      "quality",
      "resources",
      "sales",
      "settings",
      "users"
    ].map((module) => [
      `/x/${module}`,
      "The module's layout; its index redirects to the module's first page."
    ])
  ),
  "/x/timesheet/": "My Time: every employee's own timesheet.",
  "/x/accounting/projects": "Redirects to Projects.",
  "/x/settings/timekeeping": "Redirects to Time settings.",
  "/x/account/": "The signed-in person's own account.",
  "/x/acknowledge": "The ITAR acknowledgment every person signs.",
  "/x/print": "The print endpoint every page posts to.",
  "/x/shared/":
    "Notes, saved views and imports, which every page uses for its own records.",
  "/x/settings/tags/": "The tag endpoint every list page posts to.",
  "/x/get-started/": "The Implementation Hub has no sidebar entry.",
  "/x/items/$itemId/properties":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/cost/$itemId":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/delete/$itemId":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/update":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/methods/":
    "Shared by the item pages that have a method; the item's type picks the page.",
  "/x/items/revisions/":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/items/rules/":
    "Shared by the five item pages; the item's type picks the page.",
  "/x/inventory/batch-property/":
    "Batch properties of one item; the item's type picks the page.",
  "/x/credits/":
    "A memo's detail, shared by Supplier Credits and Credit Memos; the memo's party picks the page.",
  "/x/force-delete/":
    "The Admin force delete of a purchase invoice, sales invoice, receipt or payment; the document's type picks the page.",
  "/x/revenue-recognition-run/":
    "A run's detail, shared by Leases and Revenue Recognition; the run's type picks the page.",
  "/x/priority": "The layout of Priorities and Resource Planning.",
  "/x/scheduling": "The layout of Forecast and Outbound.",
  "/x/invoicing/vendor-credits": "Redirects to Supplier Credits.",
  "/x/purchasing/invoices": "Redirects to Purchase Invoices.",
  "/x/sales/invoices": "Redirects to Sales Invoices.",
  "/x/production/inspection": "Redirects to Inspection Plans.",
  "/x/production/inspection/new": "Redirects to Inspection Plans.",
  "/x/quality/inbound-inspections": "Redirects to Inspections.",
  "/x/quality/inbound-inspections/$id": "Redirects to an inspection.",
  "/x/people/people": "Redirects to Employees.",
  "/x/items/change-orders/": "Redirects to Change Notices.",
  "/x/items/change-order/": "Redirects to a change notice.",
  "/x/items/change-order-types/": "Redirects to Change Notice Types.",
  "/x/items/change-order-actions/": "Redirects to Change Notice Actions.",
  "/x/change-order/": "Redirects to a new change notice."
};

/** The registry facts the check needs; `ROUTE_REGISTRY` is the real one. */
export type RouteRegistry = {
  pages: readonly { id: string; paths: readonly string[] }[];
};

export const ROUTE_REGISTRY: RouteRegistry = { pages: PAGES };

/** Whether an `UNPAGED_ROUTES` key lists the URL (plain text: no `$param`). */
const unpaged = (key: string, url: string) => {
  if (!key.endsWith("/")) return url === key;
  const path = key.slice(0, -1);
  return url === path || url.startsWith(key);
};

/**
 * Every ERP route under `x+` belongs to one page of the access registry, so a
 * gate, the sidebar and `pageOfUrl` agree on whose screen it is, or is listed
 * in `UNPAGED_ROUTES` with the reason. `routes` are the route files relative
 * to `x+` (`inventory+/receipts.tsx`).
 *
 * It fails:
 * - a route no page covers and `UNPAGED_ROUTES` does not list, one that two
 *   pages cover equally (where `pageOfUrl` would pick by order), and one that
 *   is both on a page and listed;
 * - an `UNPAGED_ROUTES` entry that matches no route;
 * - a page path that matches no route.
 */
export function findRoutePageGaps(
  routes: readonly string[],
  registry: RouteRegistry = ROUTE_REGISTRY,
  unpagedRoutes: Readonly<Record<string, string>> = UNPAGED_ROUTES
): Violation[] {
  const violations: Violation[] = [];
  const push = (file: string, snippet: string, message: string) =>
    violations.push({ file, line: 0, snippet, message });
  const urls = routes.map((route) => ({ route, url: routeUrl(route) }));

  for (const { route, url } of urls) {
    const file = `${ERP_ROUTES_DIR}/${route}`;
    const pages = pagesOfUrl(url, registry.pages);
    const listed = Object.keys(unpagedRoutes).some((key) => unpaged(key, url));
    if (pages.length > 1)
      push(file, url, `${url} is on more than one page: ${pages.join(", ")}`);
    else if (pages.length === 1 && listed)
      push(
        file,
        url,
        `${url} is on ${pages[0]} and in UNPAGED_ROUTES; remove one`
      );
    else if (!pages.length && !listed)
      push(
        file,
        url,
        `${url} is on no page: add it to a page's \`paths\`, or to UNPAGED_ROUTES with the reason`
      );
  }

  for (const key of Object.keys(unpagedRoutes))
    if (!urls.some(({ url }) => unpaged(key, url)))
      push(THIS_FILE, key, `UNPAGED_ROUTES lists ${key}, which no route has`);

  for (const page of registry.pages)
    for (const path of page.paths)
      if (!urls.some(({ url }) => urlCoverage(path, urlSegments(url)) > 0))
        push(
          `${PAGES_DIR}/${page.id.split(".")[0]}.ts`,
          path,
          `${page.id}: no route has the path ${path}`
        );

  return violations;
}

export const routeMapsToPage: Check = {
  id: ROUTE_MAPS_TO_PAGE,
  description:
    "Every ERP route under `x+` belongs to one page of the access registry, so a gate, the sidebar and `pageOfUrl` agree on whose screen it is, or is listed in `UNPAGED_ROUTES` with the reason.",
  find: (repo) => findRoutePageGaps(repo.read(loadErpRouteFiles))
};

// --- route-gate-names-page ---

export const ROUTE_GATE_NAMES_PAGE = "route-gate-names-page";

const ROUTE = /^apps\/erp\/app\/routes\/x\+\/(.+)\.tsx?$/;
const CONSTANT = /^[A-Z][A-Z0-9_]*$/;

type Exception = { pages: readonly string[]; reason: string };

const INSPECTION_PLAN_ASSIGNMENT: Exception = {
  pages: ["quality.inspectionPlans"],
  reason:
    "the item's Quality tab assigns inspection plans: it writes itemInspectionDocumentAssignment, an Inspection Plans table"
};

const RENTAL_RATES: Exception = {
  pages: ["sales.rentalAgreements"],
  reason:
    "the item's rental rates are Rental Agreements tables (itemRentalRate, customerItemRentalRate), edited from the item's Sales tab"
};

/**
 * Routes whose gate may name other pages than the one their URL maps to, and
 * why. Keyed by the route file under `apps/erp/app/routes/x+/`. A gate passes
 * when it names the URL's page or one of `pages`.
 */
export const ROUTE_GATE_EXCEPTIONS: Readonly<Record<string, Exception>> = {
  "part+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "material+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "tool+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "consumable+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "service+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "part+/$itemId.sales.tsx": RENTAL_RATES,
  "part+/$itemId.sales.rental-rates.new.tsx": RENTAL_RATES,
  "part+/$itemId.sales.rental-rates.$rateId.tsx": RENTAL_RATES,
  "part+/$itemId.sales.rental-rates.delete.$rateId.tsx": RENTAL_RATES,
  "projects+/timesheets.$employeeId.tsx": {
    pages: ["projects.approvals"],
    reason:
      "an approver reviews one person's time here: an Approvals screen, opened under /x/projects/timesheets"
  },
  "users+/operators.reset-pin.$operatorId.tsx": {
    pages: ["settings.people"],
    reason:
      "resetting the PIN of an employee who is not a console operator is a People setting, as resetConsoleOperatorPin checks"
  }
};

const isPage = (text: string) => pageById(text) !== undefined;

/**
 * The pages a gate expression names; undefined when part of it cannot be
 * read (a variable, a property of a row, a call other than `anyOf`/`pagesOf`).
 */
function pagesNamed(
  node: ts.Node,
  constants: ReadonlyMap<string, readonly string[]>
): string[] | undefined {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
    return pagesNamed(node.expression, constants);
  if (ts.isSatisfiesExpression(node))
    return pagesNamed(node.expression, constants);
  if (ts.isStringLiteralLike(node)) return isPage(node.text) ? [node.text] : [];
  if (ts.isIdentifier(node)) {
    if (node.text === "ITEM_PAGES") return [...ITEM_PAGES];
    return constants.get(node.text)
      ? [...constants.get(node.text)!]
      : undefined;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: string[] = [];
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = property.name;
        if (ts.isStringLiteralLike(name) || ts.isIdentifier(name)) {
          if (isPage(name.text)) out.push(name.text);
          // `{ anyOf: [...] }`
          else if (name.text === "anyOf") {
            const inner = pagesNamed(property.initializer, constants);
            if (!inner) return undefined;
            out.push(...inner);
          }
        } else return undefined;
      } else if (ts.isSpreadAssignment(property)) {
        const inner = pagesNamed(property.expression, constants);
        if (!inner) return undefined;
        out.push(...inner);
      } else return undefined;
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: string[] = [];
    for (const element of node.elements) {
      const inner = pagesNamed(
        ts.isSpreadElement(element) ? element.expression : element,
        constants
      );
      if (!inner) return undefined;
      out.push(...inner);
    }
    return out;
  }
  if (ts.isConditionalExpression(node)) {
    const a = pagesNamed(node.whenTrue, constants);
    const b = pagesNamed(node.whenFalse, constants);
    return a && b ? [...a, ...b] : undefined;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const [first] = node.arguments;
    if (!first) return undefined;
    if (node.expression.text === "anyOf") return pagesNamed(first, constants);
    if (node.expression.text === "pagesOf" && ts.isStringLiteralLike(first))
      return pagesOf(first.text);
  }
  return undefined;
}

const parse = (file: string, contents: string) =>
  ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);

/**
 * The exported upper-case constants of the ERP's non-route files that name
 * pages (`export const CONTRACT_READ_GATE = anyOf([...], "View")`), so a
 * route may gate on one by name.
 */
export function gateConstants(
  files: readonly SourceFile[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { file, contents } of files) {
    if (!file.startsWith("apps/erp/app/") || ROUTE.test(file)) continue;
    if (!/export const [A-Z]/.test(contents)) continue;
    for (const statement of parse(file, contents).statements) {
      if (
        !ts.isVariableStatement(statement) ||
        !statement.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword
        )
      )
        continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !CONSTANT.test(declaration.name.text) ||
          !declaration.initializer
        )
          continue;
        const pages = pagesNamed(declaration.initializer, out);
        if (pages?.length) out.set(declaration.name.text, pages);
      }
    }
  }
  return out;
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isParenthesizedExpression(node)
    ? unwrap(node.expression)
    : node;

/**
 * The pages each exported list of the list registry gates on, by the list's
 * name: `export const receiptsList = searchList({ gate, … })` or
 * `export const paymentsList = { key, gate, … }`. A route that loads a list
 * with `loadListPage(request, receiptsList)` gates on it.
 */
export function listGates(files: readonly SourceFile[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { file, contents } of files) {
    if (!contents.includes("gate:")) continue;
    for (const statement of parse(file, contents).statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
          continue;
        const value = unwrap(declaration.initializer);
        const definition = ts.isCallExpression(value)
          ? value.arguments[0] && unwrap(value.arguments[0])
          : value;
        if (!definition || !ts.isObjectLiteralExpression(definition)) continue;
        const gate = definition.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "gate"
        );
        const pages = gate && pagesNamed(gate.initializer, new Map());
        if (pages?.length) out.set(declaration.name.text, pages);
      }
    }
  }
  return out;
}

/** The gate argument of an `authorize` call, or the list of a `loadListPage` call. */
function gateOfCall(
  node: ts.CallExpression,
  constants: ReadonlyMap<string, readonly string[]>,
  lists: ReadonlyMap<string, readonly string[]>
): string[] | undefined {
  if (!ts.isIdentifier(node.expression) || node.arguments.length < 2)
    return undefined;
  const argument = node.arguments[1]!;
  if (node.expression.text === "authorize")
    return pagesNamed(argument, constants);
  if (node.expression.text === "loadListPage" && ts.isIdentifier(argument)) {
    const pages = lists.get(argument.text);
    return pages ? [...pages] : undefined;
  }
  return undefined;
}

const ROUTE_GATE_ABOUT = {
  id: ROUTE_GATE_NAMES_PAGE,
  description:
    "An ERP route's authorize gate names the page its URL maps to in the access registry",
  provenance: {
    deprecates:
      "a route gate that names another page than the registry `paths` give its URL",
    replacedBy:
      "gate on `pageOfUrl(route)`, move the URL in the registry, or list the route in ROUTE_GATE_EXCEPTIONS with the reason",
    since: "2026-11-10"
  }
};

/**
 * A route's gate, the `authorize` gate or the gate of the list it loads with
 * `loadListPage`, names the page its URL belongs to (`pageOfUrl`), or a list
 * of pages that holds it, so the sidebar, the registry `paths` and the gate
 * agree on whose screen it is.
 */
export function routeGateNamesPage(
  constants: ReadonlyMap<string, readonly string[]>,
  lists: ReadonlyMap<string, readonly string[]> = new Map()
): ConformanceCheck {
  return {
    ...ROUTE_GATE_ABOUT,
    scan(file: string, contents: string): Violation[] {
      const route = ROUTE.exec(file)?.[1];
      if (
        !route ||
        !(contents.includes("authorize(") || contents.includes("loadListPage("))
      )
        return [];
      const page = pageOfUrl(routeUrl(route));
      if (!page) return [];
      const allowed = new Set([
        page,
        ...(ROUTE_GATE_EXCEPTIONS[file.slice(file.indexOf("x+/") + 3)]?.pages ??
          [])
      ]);
      const out: Violation[] = [];
      const source = parse(file, contents);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const pages = gateOfCall(node, constants, lists);
          if (pages?.length && !pages.some((named) => allowed.has(named))) {
            const line =
              source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            out.push({
              file,
              line,
              snippet: contents.split("\n")[line - 1]?.trim() ?? "",
              message: `The gate names ${[...new Set(pages)].join(", ")}, but the registry maps ${routeUrl(route)} to ${page}. Gate on ${page}, move the URL to the right page's \`paths\`, or add the route to ROUTE_GATE_EXCEPTIONS with the reason.`
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return out;
    }
  };
}

const erpModuleTypescript = (root: string) =>
  loadTypescriptFiles(root, ["apps/erp/app/modules"]);

const listRegistryTypescript = (root: string) =>
  loadTypescriptFiles(root, ["apps/erp/app/utils/list-registry"]);

export const routeGateNamesPageCheck: Check = {
  ...ROUTE_GATE_ABOUT,
  find: (repo) =>
    eachFile(
      repo.read(routeTypescript),
      routeGateNamesPage(
        gateConstants(repo.read(erpModuleTypescript)),
        listGates(repo.read(listRegistryTypescript))
      ).scan
    )
};

/** The authz checks, in the order they are written above. */
export const checks: Check[] = [
  edgeFunctionAuthorizesCaller,
  registryHelpersFresh,
  noAuthzDdlInMigrationsCheck,
  noLegacyRls,
  noModulePermissionKey,
  movedTablesCovered,
  routeMapsToPage,
  routeGateNamesPageCheck
];
