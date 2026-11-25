// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CallExpression,
  Function as FunctionNode,
  ParamPattern,
  Program,
  StaticMemberExpression
} from "oxc-parser";
import {
  type Check,
  type ConformanceCheck,
  eachFile,
  fileCheck,
  type SourceFile,
  type Violation
} from "../check";
import { blankComments, maskCommentsAndStrings } from "../sources/comments";
import {
  loadDbTableColumns,
  loadDbTableColumnTypes
} from "../sources/db-columns";
import { typescript } from "../sources/inputs";
import { loadModuleServerFiles } from "../sources/modules";
import {
  callArguments,
  chainCalls,
  lockedRead,
  locksBefore,
  matchBracket,
  namesColumn,
  nearestInitializer,
  type Region,
  type RowLock,
  type RowWrite,
  regionOf,
  rowLocks,
  rowWrites,
  skipSpace,
  topLevelRegions
} from "../sources/row-writes";
import {
  childrenOf,
  isNamedMember,
  type Node,
  parseTypescript,
  walk
} from "../sources/syntax";
import { IDENT_PART, IDENT_START, lineOf } from "../sources/text";

/*
 * The data-access checks: how app and job code reads and writes the database.
 * They cover the supabase-js error and filter rules, the tenant scope of a
 * Kysely write, the columns a write names, where a database client is built,
 * realtime subscriptions and the MES unit resolver. The file ends with the two
 * concurrency checks, which share the write reader in `sources/row-writes.ts`.
 */

/** One violation per match of the global `pattern`, its snippet the trimmed line the match starts on. */
function matchedLines(
  file: string,
  contents: string,
  pattern: RegExp,
  message: string
): Violation[] {
  const lines = contents.split("\n");
  const violations: Violation[] = [];
  for (const match of contents.matchAll(pattern)) {
    const line = lineOf(contents, match.index);
    violations.push({
      file,
      line,
      snippet: lines[line - 1]?.trim() ?? "",
      message
    });
  }
  return violations;
}

/**
 * A check over the app TypeScript whose scan is built from repo data (the
 * generated columns), so a test builds it from its own map.
 */
function builtFrom<T>(
  about: Omit<ConformanceCheck, "scan">,
  load: (root: string) => T,
  build: (data: T) => ConformanceCheck
): Check {
  return {
    ...about,
    find: (repo) => eachFile(repo.read(typescript), build(repo.read(load)).scan)
  };
}

const UNIQUE_VIOLATION = /["']23505["']/g;

/**
 * The helper owns the SQLSTATE. `error-reason.ts` maps every code to a user
 * message, so it names the code as a key, not as a comparison.
 */
const EXEMPT_FILES = new Set([
  "packages/utils/src/errors.ts",
  "packages/utils/src/error-reason.ts"
]);

/**
 * The literals that existed when the check landed are baselined. Each one
 * should move to `isUniqueViolation`; the baseline does not make them right.
 */
export const noInlineUniqueViolation = fileCheck(typescript, {
  id: "no-inline-unique-violation",
  description:
    'Branch on a unique violation with isUniqueViolation(), never a literal "23505".',
  provenance: {
    deprecates: 'error.code === "23505"',
    replacedBy: "isUniqueViolation(error) from @carbon/utils"
  },
  scan(file, contents) {
    if (EXEMPT_FILES.has(file)) return [];
    return matchedLines(
      file,
      contents,
      UNIQUE_VIOLATION,
      'Use isUniqueViolation(error) from @carbon/utils. A literal "23505" lets each caller drift on the code, and the helper is the one place the SQLSTATE is named.'
    );
  }
});

// Text interpolated into a PostgREST `.or()` filter is parsed as filter
// syntax: a search for "a,b" ended the filter at the comma and the request
// failed with PGRST100. `searchFilter` (`@carbon/utils`) quotes the term.
const RAW_OR_SEARCH = /\.or\(\s*`[^`]*\.ilike\.%?\$\{/g;

export const noRawOrSearch = fileCheck(typescript, {
  id: "no-raw-or-search",
  description:
    "Search text goes into an .or() filter through searchFilter, which quotes it",
  provenance: {
    deprecates: ".or(`name.ilike.%${search}%,…`)",
    replacedBy: '.or(searchFilter(["name", …], search)) from "@carbon/utils"',
    since: "2026-10-19"
  },
  scan(file: string, contents: string): Violation[] {
    return matchedLines(
      file,
      contents,
      RAW_OR_SEARCH,
      'Use `.or(searchFilter([...columns], term))` from "@carbon/utils": interpolated text is parsed as filter syntax, so a comma breaks the request'
    );
  }
});

// Realtime runs on private broadcast topics (@carbon/query). The
// `supabase_realtime` publication is empty, so a `postgres_changes`
// subscription is accepted, delivers nothing, and reports no error — the ERP
// job page sat on two such subscriptions and never showed an operation
// finished on the shop floor. A table name that has no broadcast handler does
// not compile (`RealtimeTable` is derived from the attachments manifest), so
// this string is the only way left to write a subscription that stays silent.
// See .claude/rules/realtime-system.md.
const POSTGRES_CHANGES = /["'`]postgres_changes["'`]/g;

export const noPostgresChanges = fileCheck(typescript, {
  id: "no-postgres-changes",
  description:
    "Realtime subscriptions use broadcast topics, never postgres_changes",
  provenance: {
    deprecates:
      'channel.on("postgres_changes", …) — nothing is published for it to deliver',
    replacedBy:
      "handle.realtime on the route, or useRealtime / useChangedRows / useTableChanges (@carbon/query)",
    since: "2026-10-05"
  },
  scan(file: string, contents: string): Violation[] {
    return matchedLines(
      file,
      contents,
      POSTGRES_CHANGES,
      "Declare the table in the route's `handle.realtime`, or use `useRealtime` / `useChangedRows` from @carbon/query. A table needs a broadcast handler in packages/database/src/event-system/attachments.ts."
    );
  }
});

/**
 * A `*.service.ts` file must never CONSTRUCT a database connection, pool, or
 * Kysely client. Its functions are building blocks that a service function
 * calls, and they take the handle they run on as a
 * `db: Kysely<KyselyDatabase>` argument: `ctx.asSystem.pg`, or the `tx` of an
 * open `ctx.transaction`. A client built inside the service writes outside the
 * caller's transaction, so a refusal that should roll the write back cannot.
 *
 * We flag the CONSTRUCTION primitives and the app's client getters
 * (`getDatabaseClient()`, `getJobDatabaseClient()`), not imports:
 * `import type { Kysely, KyselyDatabase }` and `import { sql } from "kysely"`
 * are ordinary, allowed service-layer imports and must never trip this.
 * `.server.ts` files and route actions (which legitimately call
 * `getDatabaseClient()`) are out of scope — only `*.service.ts` is scanned.
 * Comment lines are skipped: a building block's doc may name the getter its
 * caller uses.
 */
const DB_CLIENT_MESSAGE =
  "A *.service.ts must not construct or fetch a DB pool/Kysely client (getDatabaseClient() included) — take a `db: Kysely<KyselyDatabase>` argument and let the service function pass ctx.asSystem.pg (or its transaction), so the write joins the caller's transaction.";

const DB_CLIENT =
  /\b(?:getProcessPool|getPostgresConnectionPool)\s*\(|getPostgresClient\s*\(|new Pool\s*\(|\bPostgresDriver\b|\b(?:getDatabaseClient|getJobDatabaseClient)\s*\(/g;

const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;

export const noDbClientInService = fileCheck(typescript, {
  id: "no-db-client-in-service",
  description:
    "A *.service.ts never constructs or fetches a DB pool/Kysely client — its caller passes one in as `db` (ctx.asSystem.pg in a service function, getDatabaseClient() in a route).",
  provenance: {
    deprecates:
      "constructing a pg pool / Kysely client, or calling getDatabaseClient() / getJobDatabaseClient(), inside a *.service.ts (e.g. the removed getSchedulingDb in production.service.ts)",
    replacedBy:
      "a `db: Kysely<KyselyDatabase>` argument: ctx.asSystem.pg (or its transaction) from the service function, getDatabaseClient() from a route"
  },
  scan(file, contents) {
    // Only `*.service.ts`. A `.server.ts` is the sanctioned home for a DB
    // client, and route actions legitimately call `getDatabaseClient()`.
    if (!file.endsWith(".service.ts")) return [];
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      if (COMMENT_LINE.test(text)) return;
      for (const m of text.matchAll(DB_CLIENT)) {
        violations.push({
          file,
          line: i + 1,
          snippet: m[0],
          message: DB_CLIENT_MESSAGE
        });
      }
    });
    return violations;
  }
});

/**
 * Every Kysely `updateTable` / `deleteFrom` must carry a `companyId` predicate.
 *
 * Kysely runs on the Postgres superuser connection (`getDatabaseClient()`), so
 * RLS never applies to it — the `.where("companyId", …)` in the statement is
 * the ONLY thing between a caller and another tenant's rows. The ids these
 * statements key on usually come from the request body or the URL, and
 * `requirePermissions` proves the caller may act in THEIR company, nothing
 * about the ids. The public API makes that worse: it auto-publishes every
 * `*.service.ts` export and hands a `db` parameter that same superuser client,
 * so a service that updates by `id` alone is a cross-tenant write reachable
 * with an ordinary API key. Ten drag-sort functions (`updateQuoteLineOrder`
 * and friends) shipped exactly that way and were reported as a security
 * disclosure; they now go through `updateSortOrder`
 * (`apps/erp/app/modules/shared/sort-order.ts`).
 *
 * The rule is deliberately blunt: scope the WRITE itself, even when the ids
 * were read under `companyId` a few lines up. A scoped read proves nothing
 * once the code is refactored so the ids come from somewhere else, and the
 * extra predicate costs nothing. `company` and `companySettings` have no
 * `companyId` column — their `id` IS the tenant — so for them
 * `.where("id", …)` is the tenant predicate. A write to either still needs it:
 * an UPDATE of `companySettings` with no WHERE changes every tenant's
 * settings. Tables shared by a company GROUP carry no `companyId` at all
 * (`GROUP_SCOPED_TABLES`); their tenant key is `companyGroupId`, so a write to
 * one must name that instead.
 *
 * Only a `.where` counts: a `companyId` in `.set()` scopes nothing. A link
 * table with no `companyId` column passes when the statement scopes through
 * its parent in a subquery, because the parent's `.where("companyId", …)` is
 * part of the statement's text.
 *
 * The baselined sites write `companyGroup`, which has no `companyId` column:
 * its `id` is the tenant-group key. They are the delete in the scheduled
 * `purge-company` job, and the owner transfer in `setCompanyGroupOwner`, which
 * keys on the caller's own group and its current owner.
 *
 * Scope: Node code that holds the superuser `db` — the ERP's modules and
 * routes, the MES app and `packages/jobs`. The remaining Deno edge functions
 * are out of scope
 * (their document-level reads are scoped per
 * `.claude/rules/workflow-edge-function.md`, and their follow-on writes key on
 * ids from those reads), as is `packages/ee`, whose sync providers write
 * global tables (`user`, `invite`) that have no `companyId`.
 *
 * A statement is the text from `.updateTable(`/`.deleteFrom(` to the first
 * `.execute…(` / `.compile(` / `;` / `,` at the same bracket depth (or the
 * bracket that closes around it), comments blanked.
 * A statement built across several variables (`let q = …; q = q.where(…)`)
 * ends at the first `;` and is flagged — inline it or baseline it.
 *
 * `updateRows` / `deleteRows` (`@carbon/database/rows`) are the same writes in
 * another spelling: their last argument is the WHERE, and it must name
 * `companyId`.
 */

const UNSCOPED_MESSAGE =
  'Kysely bypasses RLS: this updateTable/deleteFrom has no companyId predicate, so ids from the request can reach another tenant\'s rows. Add .where("companyId", "=", companyId) to the statement.';

const SCOPED_PREFIXES = [
  "apps/erp/app/modules/",
  "apps/erp/app/routes/",
  "apps/mes/app/",
  "packages/jobs/src/"
];

/** Tables whose own `id` is the tenant key: `.where("id", …)` scopes them. */
const ID_KEYED_TENANT_TABLES = new Set(["company", "companySettings"]);

/** Tables keyed by user alone. */
const EXEMPT_TABLES = new Set(["userPermission"]);

/**
 * Tables with no `companyId` column, shared by every company in a group. A
 * `companyGroupId` predicate is their tenant boundary. Only add a table that
 * genuinely lacks `companyId` — on any other table a group predicate is wider
 * than the tenant.
 */
const GROUP_SCOPED_TABLES = new Set(["account", "currency"]);

const WRITE = /\.(updateTable|deleteFrom)\s*\(/g;
const COMPANY_PREDICATE =
  /\.where(?:Ref)?\s*\(\s*["'`](?:\w+\.)?companyId["'`]/;
const ID_PREDICATE = /\.where(?:Ref)?\s*\(\s*["'`](?:\w+\.)?id["'`]/;
const COMPANY_GROUP_PREDICATE =
  /\.where(?:Ref)?\s*\(\s*["'`](?:\w+\.)?companyGroupId["'`]/;
const STATEMENT_END = /^\.(?:execute\w*|compile)\s*\(/;
const ROWS_WRITE = /\b(updateRows|deleteRows)\s*\(/g;
const ROWS_MESSAGE =
  "Kysely bypasses RLS: this updateRows/deleteRows filter has no companyId, so ids from the request can reach another tenant's rows. Add companyId to the filter (the last argument).";

/** The statement's text from `from` to its end at depth 0 (see header). */
function statementFrom(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return text.slice(from, i);
      depth--;
    } else if (depth === 0) {
      if (ch === ";" || ch === ",") return text.slice(from, i);
      if (ch === "." && STATEMENT_END.test(text.slice(i, i + 40))) {
        return text.slice(from, i);
      }
    }
  }
  return text.slice(from);
}

/** The table named by the call's first argument, when it is a literal. */
function literalTable(text: string, openParen: number): string | null {
  const m = text
    .slice(openParen + 1, openParen + 200)
    .match(/^\s*["'`]([\w$]+)(?:\s+as\s+\w+)?["'`]/);
  return m?.[1] ?? null;
}

export const noUnscopedKyselyWrite = fileCheck(typescript, {
  id: "no-unscoped-kysely-write",
  description:
    "Every Kysely updateTable/deleteFrom in app/jobs code carries a companyId predicate — Kysely bypasses RLS, so the statement's own WHERE is the only tenant boundary.",
  provenance: {
    deprecates:
      'a Kysely write keyed by id alone (e.g. updateQuoteLineOrder\'s `.where("id", "=", id)`), reachable cross-tenant through the public API\'s superuser `db`',
    replacedBy:
      '.where("companyId", "=", companyId) on every updateTable/deleteFrom; drag-sorts go through updateSortOrder in modules/shared/sort-order.ts'
  },
  scan(file, contents) {
    if (!SCOPED_PREFIXES.some((prefix) => file.startsWith(prefix))) return [];
    if (!/\.updateTable|\.deleteFrom|updateRows|deleteRows/.test(contents)) {
      return [];
    }

    const text = blankComments(contents);
    const violations: Violation[] = [];
    for (const m of text.matchAll(WRITE)) {
      const start = m.index ?? 0;
      const openParen = start + m[0].length - 1;
      const table = literalTable(text, openParen);
      if (table && EXEMPT_TABLES.has(table)) continue;

      const statement = statementFrom(text, start + 1);
      if (COMPANY_PREDICATE.test(statement)) continue;
      if (
        table &&
        ID_KEYED_TENANT_TABLES.has(table) &&
        ID_PREDICATE.test(statement)
      ) {
        continue;
      }
      if (
        table &&
        GROUP_SCOPED_TABLES.has(table) &&
        COMPANY_GROUP_PREDICATE.test(statement)
      ) {
        continue;
      }

      const call = text.slice(start, text.indexOf(")", openParen) + 1);
      violations.push({
        file,
        line: lineOf(text, start),
        snippet: call.length <= 80 ? call : m[0],
        message: UNSCOPED_MESSAGE
      });
    }
    for (const m of text.matchAll(ROWS_WRITE)) {
      const start = m.index ?? 0;
      const args = callArguments(text, start + m[0].length - 1).map(
        (arg) => arg.text
      );
      if (args.length < 3) continue;
      const table = args[1]?.trim().replace(/^["'`]|["'`]$/g, "");
      if (table && EXEMPT_TABLES.has(table)) continue;
      const filter = args[args.length - 1] ?? "";
      if (/\bcompanyId\b/.test(filter)) continue;
      if (
        table &&
        ID_KEYED_TENANT_TABLES.has(table) &&
        /(?:^|[{,\s])id\b/.test(filter)
      ) {
        continue;
      }
      violations.push({
        file,
        line: lineOf(text, start),
        snippet: `${m[1]}(…, ${args[1]?.trim()}, …)`,
        message: ROWS_MESSAGE
      });
    }
    return violations;
  }
});

/**
 * A write must not name `createdBy` / `updatedBy` on a table that has no such
 * column. PostgREST rejects the whole statement with
 * `PGRST204 Could not find the 'createdBy' column of '<table>' in the schema
 * cache`, and TypeScript does not catch it — supabase-js widens the
 * insert/upsert argument enough that the excess property survives, which is how
 * `sales-rfq.$rfqId.map-lines.ts` shipped an upsert on `customerPartToItem`
 * (six columns, none of them audit) whose result was never checked, so every
 * RFQ-line → customer-part mapping silently failed.
 *
 * Roughly a third of Carbon's tables have no audit columns — favourites, link
 * tables, the lean material lookups, `companySettings` — while the convention
 * (`conventions-index.md` golden rule 3) says to include them, so this is an
 * easy assumption to carry into the wrong table.
 *
 * Scope is the KEYS of the literal row object(s) in the write's FIRST argument.
 * A payload object spread into the row (`insert([row])`) can carry the same bad
 * key, but only the caller knows what is in it.
 *
 * Both halves of the match read the parsed TypeScript, because the textual
 * version of each produced false findings and this check gates commits through
 * `collectFindings`:
 *
 *  - The write must sit in the matched target's OWN call chain
 *    (`.from("t")…insert(row)`). A character window picked up the NEXT
 *    statement's write instead, so
 *    `from("link").select("id"); from("item").insert({ createdBy })` reported
 *    `createdBy` against `link`.
 *  - A name must be a property KEY of a row object. Matching the bare name
 *    anywhere flagged an identifier used as a value
 *    (`update({ name: createdBy })`), flagged the keys of nested value objects,
 *    and missed a quoted key (`{ "createdBy": userId }`) entirely.
 */
const AUDIT_FIELDS = ["createdBy", "updatedBy"];

/** A file the check can report on: it names a target and an audit field. */
const AUDIT_TARGET = /(?:\.from|insertInto|updateTable)\(\s*["'`]\w+["'`]\s*\)/;
const AUDIT_FIELD = /\b(?:createdBy|updatedBy)\b/;

/** Chain members whose first argument carries the row(s). */
const WRITE_VERBS = new Set(["insert", "upsert", "update", "values", "set"]);

/** The text of `"t"` or `` `t` ``; undefined for any other node. */
function literalText(node: Node): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/** The table of `.from("t")`, `insertInto("t")` or `updateTable("t")`. */
function targetTable(node: Node): string | undefined {
  if (node.type !== "CallExpression" || node.arguments.length !== 1) return;
  const callee = node.callee;
  const name = isNamedMember(callee)
    ? callee.property.name
    : callee.type === "Identifier"
      ? callee.name
      : "";
  const isTarget =
    name === "insertInto" ||
    name === "updateTable" ||
    (name === "from" && isNamedMember(callee));
  const [table] = node.arguments;
  const text = table ? literalText(table) : undefined;
  if (!isTarget || text === undefined) return;
  return /^\w+$/.test(text) ? text : undefined;
}

/**
 * The table a write call (`….insert(row)`) writes, when its own chain starts
 * at a target. The chain is walked back through `.member` and `.member(…)`;
 * anything else (`?.`, a cast, an index) ends it, and so does an earlier write
 * call, which is the one the target's row belongs to.
 */
function writtenTable(write: CallExpression): string | undefined {
  if (!isNamedMember(write.callee)) return;
  if (!WRITE_VERBS.has(write.callee.property.name)) return;
  let access: StaticMemberExpression = write.callee;
  for (;;) {
    if (access.optional) return;
    const link = access.object;
    if (isNamedMember(link)) {
      access = link;
      continue;
    }
    const table = targetTable(link);
    if (table) return table;
    if (link.type !== "CallExpression") return;
    if (!isNamedMember(link.callee)) return;
    if (WRITE_VERBS.has(link.callee.property.name)) return;
    access = link.callee;
  }
}

type RowKey = { name: string; start: number };

/**
 * The keys of the row objects in a write's FIRST argument. A ROW object is an
 * object literal with no enclosing object literal, so `insert({…})` and
 * `insert([{…}, {…}])` both yield rows while a nested value object does not.
 * Shorthand, `key:` and `"key":` forms all count; a computed `[key]:`, a
 * method and an accessor do not.
 */
function rowKeys(node: Node, keys: RowKey[] = []): RowKey[] {
  if (node.type === "ObjectExpression") {
    for (const property of node.properties) {
      if (
        property.type !== "Property" ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      ) {
        continue;
      }
      const { key } = property;
      if (key.type === "Identifier") {
        keys.push({ name: key.name, start: key.start });
      } else if (key.type === "Literal" && typeof key.value === "string") {
        keys.push({ name: key.value, start: key.start });
      }
    }
    return keys;
  }
  for (const child of childrenOf(node)) rowKeys(child, keys);
  return keys;
}

const AUDIT_ABOUT = {
  id: "no-missing-audit-column",
  description:
    "A write never names createdBy/updatedBy on a table that has no such column — PostgREST rejects the statement with PGRST204 and TypeScript does not catch it.",
  provenance: {
    deprecates:
      "stamping createdBy/updatedBy on a table without audit columns (the customerPartToItem upsert in sales-rfq.$rfqId.map-lines.ts, which failed every call)",
    replacedBy: "writing only the columns the table has",
    since: "PGRST204 on items_upsertItemCustomerPart"
  }
};

/**
 * The check is closed over each table's columns, which `loadDbTableColumns`
 * reads from the generated `Row:` blocks. The I/O stays in `sources/`, so
 * `scan` stays pure and a test passes its own map. The one site it found was
 * fixed when the check landed, so any finding is new.
 */
export function noMissingAuditColumn(
  columns: Map<string, Set<string>>
): ConformanceCheck {
  return {
    ...AUDIT_ABOUT,
    scan(file, contents) {
      // Parse only a file that could hold a finding.
      if (!AUDIT_TARGET.test(contents) || !AUDIT_FIELD.test(contents)) {
        return [];
      }
      const { program } = parseTypescript(file, contents);
      const violations: Violation[] = [];
      walk(program, (node) => {
        if (node.type !== "CallExpression") return;
        const table = writtenTable(node);
        const present = table ? columns.get(table) : undefined;
        const [row] = node.arguments;
        if (!present || !row) return;
        for (const key of rowKeys(row)) {
          if (!AUDIT_FIELDS.includes(key.name) || present.has(key.name)) {
            continue;
          }
          violations.push({
            file,
            line: lineOf(contents, key.start),
            snippet: key.name,
            message: `"${table}" has no "${key.name}" column — this write fails with PGRST204 (and TypeScript will not flag it). Remove the field.`
          });
        }
      });
      return violations;
    }
  };
}

export const noMissingAuditColumnCheck = builtFrom(
  AUDIT_ABOUT,
  loadDbTableColumns,
  noMissingAuditColumn
);

/**
 * A service function's `payload(ctx, value)…forCreate()` (or `forUpdate`,
 * `forUpsert`, `for(op)`, `build`) adds identity fields to the payload it
 * hands a building block. When the building block
 * spreads that payload into a write, every added field is a column of the
 * write: one the table does not have fails the whole statement (PGRST204),
 * and `createdBy` added to a payload that only ever reaches an `.update(`
 * rewrites the row's author on every save. Both shipped: `createAccount`
 * stamped `companyId` onto the group-scoped `account`, `upsertItemCost`
 * restamped `createdBy` on each cost edit.
 *
 * Follows each `payload(...)` chain in `<module>.server.ts` into the `service.<fn>(...)`
 * it is passed to, finds that function in `<module>.service.ts`, and reads
 * the writes whose row is the parameter itself (`insert([p])`, `...p`,
 * `sanitize(p)`, or one local initialized from it). A field of a nested object
 * (`...p.contact`) is never added by `payload`, so it is not followed.
 *
 * The added fields follow `payload`'s own rules: a list gets only `createdBy`,
 * and `forUpdate` drops `createdBy`.
 */
export function findStampColumnMismatches(
  modules: { server: SourceFile; service: SourceFile }[],
  columns: Map<string, Set<string>>
): Violation[] {
  const out: Violation[] = [];
  for (const { server, service } of modules) {
    const serviceFns = topLevelFunctions(
      parseTypescript(service.file, service.contents).program
    );
    const serverTree = parseTypescript(server.file, server.contents).program;
    walk(serverTree, (node, ancestors) => {
      const chain = payloadChain(node);
      if (!chain) return;
      const { fields, operation } = chain;
      const outer = enclosingServiceCall(ancestors);
      if (!outer) return;
      const fn = serviceFns.get(outer.name);
      const index = outer.call.arguments.findIndex((a) => contains(a, node));
      const param = fn?.params[index];
      const named = param ? namedParameter(param) : undefined;
      if (!fn?.body || !named) return;
      const type = named.type
        ? service.contents.slice(named.type.start, named.type.end)
        : "";
      const isList = /\[\]\s*$|^\s*Array</.test(type);
      const added = fields.filter((field) =>
        field === "createdBy"
          ? operation !== "update"
          : isList
            ? false
            : field === "updatedBy"
              ? operation !== "create"
              : true
      );
      const writes = carriedWrites(fn.body, named.name, service.contents);
      if (writes.length === 0) return;
      const line = lineOf(server.contents, node.start);
      const leaf = leafName(ancestors);
      for (const table of new Set(writes.map((write) => write.table))) {
        const missing = added.filter((f) => !columns.get(table)?.has(f));
        if (columns.has(table) && missing.length > 0) {
          out.push({
            file: server.file,
            line,
            snippet: `${leaf} ${table} ${missing.join(",")}`,
            message: `${leaf} stamps ${missing.join(", ")} onto a row of "${table}", which has no such column: the write fails. Stamp only the fields the table has.`
          });
        }
      }
      if (
        added.includes("createdBy") &&
        writes.every((write) => write.verb === "update")
      ) {
        out.push({
          file: server.file,
          line,
          snippet: `${leaf} createdBy-on-update`,
          message: `${leaf} stamps createdBy onto a payload that only reaches an update, which rewrites the row's author. Stamp updatedBy instead.`
        });
      }
    });
  }
  return out;
}

function contains(outer: Node, inner: Node): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** Every function declared at the top level of the file, exported or not. */
function topLevelFunctions(program: Program): Map<string, FunctionNode> {
  const out = new Map<string, FunctionNode>();
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type === "FunctionDeclaration" && declaration.id) {
      out.set(declaration.id.name, declaration);
    }
  }
  return out;
}

/**
 * The name and type of a parameter that is one name: `p`, `p: T`,
 * `p: T = v` or `...p: T`. A destructured parameter has no one name.
 */
function namedParameter(
  param: ParamPattern
): { name: string; type?: Node } | undefined {
  if (param.type === "Identifier") {
    return { name: param.name, type: param.typeAnnotation?.typeAnnotation };
  }
  if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
    return {
      name: param.left.name,
      type: param.left.typeAnnotation?.typeAnnotation
    };
  }
  if (param.type === "RestElement" && param.argument.type === "Identifier") {
    return {
      name: param.argument.name,
      type: param.typeAnnotation?.typeAnnotation
    };
  }
  return undefined;
}

const TERMINALS: Record<string, { fields: string[]; operation?: string }> = {
  forCreate: { fields: ["createdBy"], operation: "create" },
  forUpdate: { fields: ["updatedBy"], operation: "update" },
  forUpsert: { fields: ["createdBy", "updatedBy"] },
  for: { fields: ["createdBy", "updatedBy"] },
  build: { fields: [] }
};

/**
 * The fields and operation of a `payload(ctx, value).<modifiers>.<terminal>()`
 * chain, read off its calls; undefined for any other node.
 */
function payloadChain(
  node: Node
): { fields: string[]; operation?: string } | undefined {
  if (node.type !== "CallExpression" || !isNamedMember(node.callee)) {
    return undefined;
  }
  const name = node.callee.property.name;
  const terminal = Object.hasOwn(TERMINALS, name) ? TERMINALS[name] : undefined;
  if (!terminal) return undefined;
  const fields = new Set(["companyId", ...terminal.fields]);
  const operation =
    name === "for" ? stringValue(node.arguments[0]) : terminal.operation;
  let inner: Node = node.callee.object;
  while (inner.type === "CallExpression" && isNamedMember(inner.callee)) {
    const modifier = inner.callee.property.name;
    if (modifier === "withGroup") fields.add("companyGroupId");
    else if (modifier === "withUser") fields.add("userId");
    else if (modifier === "withoutCompany") fields.delete("companyId");
    else return undefined;
    inner = inner.callee.object;
  }
  if (
    inner.type !== "CallExpression" ||
    inner.callee.type !== "Identifier" ||
    inner.callee.name !== "payload"
  ) {
    return undefined;
  }
  return { fields: [...fields], operation };
}

/** The value of a `"…"` string literal; a template literal is not one. */
function stringValue(node: Node | undefined): string | undefined {
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}

const isFunction = (node: Node) =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

/**
 * The `service.<name>(…)` call the stamped value is an argument of: the
 * nearest of its `ancestors`, unless a function lies between them.
 */
function enclosingServiceCall(
  ancestors: Node[]
): { call: CallExpression; name: string } | undefined {
  for (const n of ancestors.toReversed()) {
    if (
      n.type === "CallExpression" &&
      isNamedMember(n.callee) &&
      n.callee.object.type === "Identifier" &&
      n.callee.object.name === "service"
    ) {
      return { call: n, name: n.callee.property.name };
    }
    if (isFunction(n)) return undefined;
  }
  return undefined;
}

/** The name of the nearest variable the stamped value is declared in. */
function leafName(ancestors: Node[]): string {
  for (const n of ancestors.toReversed()) {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
      return n.id.name;
    }
  }
  return "?";
}

/** Writes whose row is `param` itself, with their table. */
function carriedWrites(
  body: Node,
  param: string,
  contents: string
): { table: string; verb: string }[] {
  const out: { table: string; verb: string }[] = [];
  const textOf = (node: Node) => contents.slice(node.start, node.end);
  const carriesName = (arg: Node, name: string) => {
    const text = textOf(arg).replace(/\s+/g, "");
    return (
      text === name ||
      text === `[${name}]` ||
      new RegExp(`\\.\\.\\.(sanitize\\()?${name}(?![.\\w])`).test(text) ||
      text.includes(`sanitize(${name})`)
    );
  };
  // One level of aliasing: `const data = sanitize(param)` carries it too.
  const names = [param];
  walk(body, (node) => {
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init &&
      carriesName(node.init, param)
    ) {
      names.push(node.id.name);
    }
  });
  const carries = (arg: Node) => names.some((name) => carriesName(arg, name));
  walk(body, (node) => {
    if (node.type !== "CallExpression" || !isNamedMember(node.callee)) return;
    const verb = node.callee.property.name;
    const [row] = node.arguments;
    if (
      !["insert", "update", "upsert"].includes(verb) ||
      !row ||
      !carries(row)
    ) {
      return;
    }
    const table = fromTable(node.callee.object, contents);
    if (table) out.push({ table, verb });
  });
  return out;
}

/**
 * The `.from("t")` at the root of a builder chain, never `storage.from`. The
 * walk passes `(…)` and `as T`, and the `?.` chain a pair of parentheses
 * closes.
 */
function fromTable(node: Node, contents: string): string | undefined {
  let n: Node = node;
  for (;;) {
    if (n.type === "CallExpression") {
      const callee = n.callee;
      if (
        isNamedMember(callee) &&
        callee.property.name === "from" &&
        !contents
          .slice(callee.object.start, callee.object.end)
          .endsWith("storage")
      ) {
        return stringValue(n.arguments[0]);
      }
      n = callee;
    } else if (isNamedMember(n)) {
      n = n.object;
    } else if (
      n.type === "ParenthesizedExpression" ||
      n.type === "TSAsExpression" ||
      n.type === "ChainExpression"
    ) {
      n = n.expression;
    } else {
      return undefined;
    }
  }
}

export const stampMatchesColumns: Check = {
  id: "stamp-matches-columns",
  description:
    "A service function's `payload(ctx, value)…forCreate()` (or `forUpdate`, `forUpsert`, `for(op)`, `build`) adds identity fields to the payload it hands a building block.",
  find: (repo) =>
    findStampColumnMismatches(
      repo.read(loadModuleServerFiles),
      repo.read(loadDbTableColumns)
    )
};

/**
 * supabase-js never throws: a failed query resolves to `data: null`, so
 * reading `data` without `error` turns a failure into "none" (cfdc4f9299).
 */

const DISCARDED_QUERY_MESSAGE =
  "Check `error` before reading `data`: a failed supabase-js read must not mean 'none'. Bind `error` and `if (error) return/throw` it — and bind a write's result and check it.";

const REQUEST = /\.\s*(?:from|rpc|invoke)\s*(?:<[^()]*>\s*)?\(/;
const QUERY_CALLS = new Set(["from", "rpc"]);
const DECLARATIONS = new Set(["const", "let", "var"]);
const WRITE_CALLS = new Set(["insert", "update", "upsert", "delete"]);
/** Kysely builders also have `.from(` (`updateTable(…).from(…)`). */
const KYSELY_CALLS = /^(?:execute\w*|compile|stream)$/;

type Segment = { name: string; call: boolean };
type Chain = { head: string; segments: Segment[]; end: number };

function skipSpaceBack(text: string, i: number): number {
  while (i >= 0 && /\s/.test(text[i] as string)) i--;
  return i;
}

/** Assumes comments and strings are masked. */
function matchForward(text: string, open: number): number {
  const opener = text[open] as string;
  const closer = { "(": ")", "[": "]", "{": "}", "<": ">" }[opener];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchBack(text: string, close: number): number {
  const closer = text[close] as string;
  const opener = { ")": "(", "]": "[", "}": "{" }[closer];
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === closer) depth++;
    else if (text[i] === opener) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readIdent(text: string, i: number): number {
  if (!IDENT_START.test(text[i] ?? "")) return i;
  let end = i + 1;
  while (end < text.length && IDENT_PART.test(text[end] as string)) end++;
  return end;
}

/**
 * The member chain starting at `i`: an identifier or parenthesised head, then
 * `.name`, `?.name`, `(…)`, `[…]`, `!` and `<T>(…)` segments. Ends at the first
 * character that continues no chain.
 */
function parseChain(text: string, start: number): Chain | null {
  let i = skipSpace(text, start);
  let head: string;
  if (text[i] === "(") {
    const close = matchForward(text, i);
    if (close === -1) return null;
    head = "(";
    i = close + 1;
  } else {
    const end = readIdent(text, i);
    if (end === i) return null;
    head = text.slice(i, end);
    i = end;
  }
  const segments: Segment[] = [];
  for (;;) {
    const k = skipSpace(text, i);
    const c = text[k];
    if (c === "!" && text[k + 1] !== "=") {
      i = k + 1;
      continue;
    }
    let dot = -1;
    if (c === ".") dot = k + 1;
    else if (c === "?" && text[k + 1] === ".") dot = k + 2;
    if (dot !== -1) {
      const at = skipSpace(text, dot);
      if (text[at] === "(" || text[at] === "[") {
        i = at;
        continue;
      }
      const end = readIdent(text, at);
      if (end === at) return { head, segments, end: k };
      let next = skipSpace(text, end);
      if (text[next] === "<") {
        const close = matchForward(text, next);
        const after = close === -1 ? -1 : skipSpace(text, close + 1);
        if (after !== -1 && text[after] === "(") next = after;
      }
      if (text[next] === "(") {
        const close = matchForward(text, next);
        if (close === -1) return null;
        segments.push({ name: text.slice(at, end), call: true });
        i = close + 1;
      } else {
        segments.push({ name: text.slice(at, end), call: false });
        i = end;
      }
      continue;
    }
    if (c === "(" || c === "[") {
      const close = matchForward(text, k);
      if (close === -1) return null;
      i = close + 1;
      continue;
    }
    return { head, segments, end: i };
  }
}

function classify(chain: Chain): { query: boolean; write: boolean } {
  const none = { query: false, write: false };
  if (/^[A-Z]/.test(chain.head)) return none;
  const { segments } = chain;
  if (segments.some((s) => s.call && KYSELY_CALLS.test(s.name))) return none;
  const fromAt = segments.findIndex((s) => s.call && s.name === "from");
  const query =
    segments.some((s) => s.call && QUERY_CALLS.has(s.name)) ||
    segments.some(
      (s, n) =>
        !s.call &&
        s.name === "functions" &&
        segments[n + 1]?.call === true &&
        segments[n + 1]?.name === "invoke"
    );
  const write =
    fromAt !== -1 &&
    segments.slice(fromAt + 1).some((s) => s.call && WRITE_CALLS.has(s.name));
  return { query, write };
}

/** Top-level keys only; a rest element yields `...`. */
function patternKeys(text: string, open: number, close: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let expectKey = true;
  for (let i = open + 1; i < close; i++) {
    const c = text[i] as string;
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) expectKey = true;
    else if (expectKey && depth === 0 && !/\s/.test(c)) {
      expectKey = false;
      if (text.startsWith("...", i)) {
        keys.push("...");
        continue;
      }
      const end = readIdent(text, i);
      if (end > i) keys.push(text.slice(i, end));
    }
  }
  return keys;
}

function destructureBefore(
  text: string,
  eq: number
): { open: number; close: number } | null {
  const close = skipSpaceBack(text, eq - 1);
  if (text[close] !== "}") return null;
  const open = matchBack(text, close);
  if (open === -1) return null;
  const before = skipSpaceBack(text, open - 1);
  if (text[before] === "(") return { open, close };
  const keyword = text.slice(wordStart(text, before), before + 1);
  return ["const", "let", "var"].includes(keyword) ? { open, close } : null;
}

type Bound = { name: string; start: number };

/** `const name =`, `name =` starting a statement, or `const name: Type =`. */
function nameBefore(text: string, eq: number): Bound | null {
  const end = skipSpaceBack(text, eq - 1);
  const declared = declaredName(text, end);
  if (declared) return declared;
  if (IDENT_PART.test(text[end] ?? "")) {
    const start = wordStart(text, end);
    if (startsStatement(text, start)) {
      return { name: text.slice(start, end + 1), start };
    }
  }
  const colon = annotationColon(text, end);
  if (colon === -1) return null;
  return declaredName(text, skipSpaceBack(text, colon - 1));
}

function declaredName(text: string, end: number): Bound | null {
  if (!IDENT_PART.test(text[end] ?? "")) return null;
  const start = wordStart(text, end);
  const keyEnd = skipSpaceBack(text, start - 1);
  const keyStart = wordStart(text, keyEnd);
  if (!DECLARATIONS.has(text.slice(keyStart, keyEnd + 1))) return null;
  return { name: text.slice(start, end + 1), start: keyStart };
}

/** The `:` opening a type annotation that ends at `end`, or -1. */
function annotationColon(text: string, end: number): number {
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    const c = text[i] as string;
    if (")]}>".includes(c)) depth++;
    if ("([{<".includes(c)) depth--;
    if (depth < 0) return -1;
    if (depth === 0 && c === ":") return i;
    if (depth === 0 && c === ";") return -1;
  }
  return -1;
}

function wordStart(text: string, end: number): number {
  let start = end;
  while (start > 0 && IDENT_PART.test(text[start - 1] as string)) start--;
  return start;
}

/** False once `name` is handed on (returned, passed, spread, reassigned): the receiver may check the error. */
function readsDataNotError(
  text: string,
  name: string,
  declaredAt: number,
  from: number
): boolean {
  let open = declaredAt;
  for (let depth = 0; open >= 0; open--) {
    if (text[open] === "}") depth++;
    else if (text[open] === "{") {
      if (depth === 0) break;
      depth--;
    }
  }
  const close = open < 0 ? text.length : matchForward(text, open);
  const body = text.slice(from, close === -1 ? text.length : close);
  const use = new RegExp(
    `(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`,
    "g"
  );
  let readsResult = false;
  for (const m of body.matchAll(use)) {
    const at = m.index ?? 0;
    // `other.name` is another object's property; `...name` hands it on.
    if (body[at - 1] === "." && body.slice(at - 3, at) !== "...") continue;
    const after = body
      .slice(at + name.length)
      .match(/^\s*!?\s*\??\.\s*([\w$]+)/);
    const member = after?.[1];
    if (!member) return false;
    if (member === "error") return false;
    if (member === "data" || member === "count") readsResult = true;
  }
  return readsResult;
}

function startsStatement(text: string, at: number): boolean {
  const prev = skipSpaceBack(text, at - 1);
  if (prev < 0) return true;
  const c = text[prev];
  if (c === ";" || c === "{" || c === "}") return true;
  if (text.slice(wordStart(text, prev), prev + 1) === "else") return true;
  if (c === ")") {
    const open = matchBack(text, prev);
    const kw = text.slice(Math.max(0, open - 7), open).trimEnd();
    return /(?:^|[^\w$])(?:if|for|while)$/.test(kw);
  }
  return false;
}

function endsStatement(text: string, end: number): boolean {
  const next = skipSpace(text, end);
  if (next >= text.length) return true;
  const c = text[next];
  if (c === ";" || c === "}") return true;
  return text.slice(end, next).includes("\n") && /[\w$]/.test(c as string);
}

function snippetOf(contents: string, from: number, to: number): string {
  const text = contents
    .slice(from, to)
    .replace(/\s+/g, " ")
    .replace(/ (\??\.)/g, "$1")
    .trim();
  return text.length <= 120 ? text : `${text.slice(0, 117)}...`;
}

function requestEnd(text: string, from: number): number {
  const re = new RegExp(REQUEST.source, "g");
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return from;
  const close = matchForward(text, m.index + m[0].length - 1);
  return close === -1 ? m.index + m[0].length : close + 1;
}

/**
 * A supabase-js result is never read without its `error`. The incidents:
 * - the consolidated ledger drill-down read every company when its
 *   company-group read failed (cfdc4f9299);
 * - a price-list export ended early instead of failing (b399972472);
 * - an approval check read a failed query as "nothing pending" (c0b85077ee);
 * - the RFQ-line `customerPartToItem` upsert failed on every call, because its
 *   result was never bound (22c9b98508).
 *
 * It reads an awaited chain that calls `.from(…)`, `.rpc(…)` or
 * `.functions.invoke(…)`, so `.storage.from(…)` counts too. A chain whose head
 * is PascalCase (`Array.from`) is skipped. So is a chain with a Kysely
 * `.execute…()`, `.compile()` or `.stream()`. It fails four shapes:
 * 1. A destructure that binds `data` or `count` and not `error`. A `...rest`
 *    counts as binding `error`.
 * 2. `(await …).data` or `(await …).count`.
 * 3. `const r = await …` when the enclosing block reads `r.data` or `r.count`,
 *    never reads `r.error`, and never hands `r` on (returns, passes, spreads or
 *    reassigns it). The receiver may check the error.
 * 4. An awaited `.from(…).insert/update/upsert/delete(…)` used as a bare
 *    statement.
 *
 * The fix: bind `error`, and return or throw on it. A best-effort write still
 * binds its result and logs the error.
 *
 * Left to others: a bound `error` that is never read fails Biome's
 * `noUnusedVariables`. What the code does with the error is beyond a text
 * check.
 *
 * Known gaps: a query builder kept in a variable (`const q = client.from(…);
 * await q`, the second half of b399972472), `Promise.all` results, and the
 * `{ data }` result of a service function (`await getX(client)`).
 *
 * There is no allow comment: the baseline holds each deliberate exception.
 * Two hits with the same snippet in one file share one baseline key.
 *
 * It reads browser code too. About a quarter of the hits were there, and the
 * sampled ones were real: a notes autosave that dropped a failed update, and a
 * picker that showed an empty list on a failed read.
 */
export const noDiscardedQueryError = fileCheck(typescript, {
  id: "no-discarded-query-error",
  description:
    "A supabase-js result is never read without its error: no `{ data }` destructure without `error`, no `(await …).data`, no `r.data` from a result whose `r.error` is never read, and no awaited write whose result is dropped.",
  provenance: {
    deprecates:
      "`const { data } = await client.from(…)`, `result.data` with no `result.error`, and unbound awaited writes, which read a failed query as 'none' (cfdc4f9299, b399972472, c0b85077ee, 22c9b98508)",
    replacedBy:
      "`const { data, error } = await …; if (error) …`, and every write's result bound and checked",
    incidents: ["cfdc4f9299", "b399972472", "c0b85077ee", "22c9b98508"]
  },
  scan(file, contents) {
    if (!/\bawait\b/.test(contents)) return [];
    if (!REQUEST.test(contents)) return [];
    const text = maskCommentsAndStrings(contents);
    const violations: Violation[] = [];
    const report = (at: number, snippet: string) =>
      violations.push({
        file,
        line: lineOf(contents, at),
        snippet,
        message: DISCARDED_QUERY_MESSAGE
      });

    for (const m of text.matchAll(/\bawait\b/g)) {
      const at = m.index ?? 0;
      if (at > 0 && /[\w$.]/.test(text[at - 1] as string)) continue;
      const chain = parseChain(text, at + m[0].length);
      if (!chain) continue;
      const { query, write } = classify(chain);
      if (!query) continue;
      const request = requestEnd(text, at);

      const prev = skipSpaceBack(text, at - 1);
      if (text[prev] === "=" && !/[=!<>]/.test(text[prev - 1] ?? "")) {
        const bound = nameBefore(text, prev);
        if (bound) {
          if (readsDataNotError(text, bound.name, bound.start, chain.end)) {
            report(bound.start, snippetOf(contents, bound.start, request));
          }
          continue;
        }
        const pattern = destructureBefore(text, prev);
        if (!pattern) continue;
        const keys = patternKeys(text, pattern.open, pattern.close);
        const readsResult = keys.includes("data") || keys.includes("count");
        if (readsResult && !keys.includes("error") && !keys.includes("...")) {
          const before = skipSpaceBack(text, pattern.open - 1);
          const from =
            text[before] === "(" ? pattern.open : wordStart(text, before);
          report(from, snippetOf(contents, from, request));
        }
        continue;
      }

      if (text[prev] === "(") {
        const close = skipSpace(text, chain.end);
        if (text[close] !== ")") continue;
        const member = text
          .slice(close + 1)
          .match(/^\s*\??\.\s*(data|count)\b/);
        if (member) {
          report(at, `(${snippetOf(contents, at, request)}…).${member[1]}`);
        }
        continue;
      }

      if (
        write &&
        startsStatement(text, at) &&
        endsStatement(text, chain.end)
      ) {
        const verb = chain.segments.find(
          (s) => s.call && WRITE_CALLS.has(s.name)
        );
        report(at, `${snippetOf(contents, at, request)}.${verb?.name}(`);
      }
    }
    return violations;
  }
});

// On a later operation of a serial part, a write names the unit the operator
// picked or scanned, never one the server chose. `resolveWorkUnit`
// (apps/mes/app/services/work-unit.server.ts) owns that rule, so every
// top-level function that writes a unit calls it, or is listed below with the
// reason it does not need to. Only the resolver picks a unit on the server.
//
// A nested callback counts as the top-level function it sits in, read as the
// concurrency checks read it (`topLevelRegions`, so a class method is
// `Class.method`). The test
// holds the allow-lists to the repo (`unitWriters`, `unitPickers`): every
// entry must still name a function that writes or picks, so a stale entry
// cannot pre-approve a later one. The check proves that the function calls
// the resolver, not that it honours the resolver's refusal.
const SCOPE = /^apps\/mes\/app\/(?:routes\/x\+|services)\//;
const RESOLVER = "apps/mes/app/services/work-unit.server.ts";

/** Postings whose input names a serial unit. */
const UNIT_POSTING_TYPES = [
  "jobOperationSerialComplete",
  "jobOperationScrap",
  "trackedEntitiesToOperation",
  "unconsumeTrackedEntities",
  "scrapTrackedEntity"
];

/** MES helpers that write a unit; their callers are checked by name. */
const UNIT_WRITE_CALLS = [
  "startProductionEvent",
  "startMachineProductionEvent",
  "insertAttributeRecord",
  "insertReworkQuantity",
  "insertProductionQuantity",
  "insertProductionQuantityIfCurrent",
  "insertScrapQuantity",
  "completeAllStepsForUnit",
  "createQualityIssue"
];

/** Production tables whose new row names the unit it was made for. */
const UNIT_TABLES =
  "jobOperationStepRecord|trackedActivity|trackedActivityOutput|productionEvent|productionQuantity";

/** The writes that name or imply a serial unit (matched with comments blanked). */
const UNIT_WRITES = [
  new RegExp(`type:\\s*["'](?:${UNIT_POSTING_TYPES.join("|")})["']`, "g"),
  /["']trigger-(?:rework|correction)["']/g,
  new RegExp(
    `(?<!function\\s)\\b(?:${UNIT_WRITE_CALLS.join("|")})\\s*\\(`,
    "g"
  ),
  new RegExp(
    `\\.from\\(\\s*["'](?:${UNIT_TABLES})["']\\s*\\)\\s*\\.(?:insert|upsert)\\b`,
    "g"
  ),
  new RegExp(`\\binsertInto\\(\\s*["'](?:${UNIT_TABLES})\\b[^"']*["']`, "g")
];

/** The server picks the unit with these; only the resolver may. */
const SERVER_PICKS =
  /\b(?:isSerialEntityIncompleteForOperation|getNextIncompleteSerialEntity)\b/g;

/**
 * Functions (`file#function`) that write a unit without the resolver, each
 * with its reason. A function that defines one of `UNIT_WRITE_CALLS` needs no
 * entry: it is the writer, and its callers are checked.
 */
export const UNIT_WRITE_ALLOW_LIST: Record<string, string> = {
  "apps/mes/app/routes/x+/trigger-rework.tsx#action":
    "the units are chosen explicitly in the dialog",
  "apps/mes/app/routes/x+/inspection-lot.$id.disposition.tsx#action":
    "inspection lot: the units are the lot's samples and the operator's allocation",
  "apps/mes/app/services/quality.server.ts#postSerialCompletions":
    "inspection lot: completes the lot's passed samples, read server-side",
  "apps/mes/app/services/quality.server.ts#postBulkCompletion":
    "inspection lot: a non-serial completion, which names no unit",
  "apps/mes/app/services/quality.server.ts#createInspectionRejectionIssue":
    "inspection lot: the rejection NCR takes the lot's sampled units",
  "apps/mes/app/services/operations.service.ts#insertBatchStepRecords":
    "a batch records index 0 on every member operation and names no unit"
};

/**
 * Functions (`file#function`) that test a unit's state outside the resolver,
 * each with its reason. None of them chooses the unit a write names.
 */
export const UNIT_PICK_ALLOW_LIST: Record<string, string> = {
  "apps/mes/app/routes/x+/operation.$operationId.tsx#loader":
    "first operation only: chooses the unit the page opens on and writes nothing",
  "apps/mes/app/services/traveler.server.ts#resolveTravelerScan":
    "tells where the scanned unit is open; the scan names the unit",
  "apps/mes/app/services/traveler.server.ts#getClaimOptions":
    "lists the open units the operator may claim; the claim goes through resolveWorkUnit"
};

type Write = { index: number; snippet: string };

function unitWrites(code: string, masked: string): Write[] {
  const writes: Write[] = [];
  for (const pattern of UNIT_WRITES) {
    for (const m of code.matchAll(pattern)) {
      // A match inside a string is text, not code.
      if (masked[m.index] !== code[m.index]) continue;
      writes.push({ index: m.index, snippet: m[0].replace(/\s+/g, "") });
    }
  }
  // An `issue` posting whose type is not a literal could be any of them.
  for (const m of code.matchAll(/\b(?:erpPosting|post)\(\s*["']issue["']/g)) {
    if (masked[m.index] !== code[m.index]) continue;
    const open = m.index + m[0].indexOf("(");
    const args = code.slice(open, matchBracket(masked, open) + 1);
    if (!/\btype:\s*["'][\w-]+["']/.test(args)) {
      writes.push({ index: m.index, snippet: m[0].replace(/\s+/g, "") });
    }
  }
  return writes.sort((a, b) => a.index - b.index);
}

const RESOLVES = /(?<!function\s)\bresolveWorkUnit\s*\(/g;

type Analysis = {
  writes: (Write & { key: string; region?: Region })[];
  picks: { index: number; snippet: string; key: string }[];
  resolving: Set<Region>;
};

function analyze(file: string, contents: string): Analysis {
  const code = blankComments(contents);
  const masked = maskCommentsAndStrings(contents);
  const regions = topLevelRegions(masked);
  const keyOf = (region?: Region) => `${file}#${region?.name ?? "<top>"}`;

  const resolving = new Set<Region>();
  for (const m of masked.matchAll(RESOLVES)) {
    const region = regionOf(regions, m.index);
    if (region) resolving.add(region);
  }

  const writes = unitWrites(code, masked)
    .map((w) => {
      const region = regionOf(regions, w.index);
      return { ...w, region, key: keyOf(region) };
    })
    // The definition of a checked writer is the writer itself.
    .filter((w) => !(w.region && UNIT_WRITE_CALLS.includes(w.region.name)));

  const picks = [...masked.matchAll(SERVER_PICKS)]
    .filter((m) => {
      const region = regionOf(regions, m.index);
      const isImport = region && masked.startsWith("import", region.start);
      const isDefinition = /function\s*$/.test(
        masked.slice(Math.max(0, m.index - 20), m.index)
      );
      return !isImport && !isDefinition;
    })
    .map((m) => ({
      index: m.index,
      snippet: m[0],
      key: keyOf(regionOf(regions, m.index))
    }));

  return { writes, picks, resolving };
}

export const mesUnitWriteResolvesUnit = fileCheck(typescript, {
  id: "mes-unit-write-resolves-unit",
  description:
    "An MES function that writes a serial unit calls resolveWorkUnit, and only the resolver picks a unit on the server",
  provenance: {
    deprecates:
      "an MES route that checks (or picks) the serial unit it writes on its own",
    replacedBy:
      "`resolveWorkUnit` in apps/mes/app/services/work-unit.server.ts",
    since: "2026-11-18"
  },
  scan(file: string, contents: string): Violation[] {
    if (!SCOPE.test(file) || file === RESOLVER) return [];
    const { writes, picks, resolving } = analyze(file, contents);
    const violations: Violation[] = [];

    for (const pick of picks) {
      if (pick.key in UNIT_PICK_ALLOW_LIST) continue;
      violations.push({
        file,
        line: lineOf(contents, pick.index),
        snippet: pick.snippet,
        message:
          "Only the resolver picks a unit on the server: call resolveWorkUnit, or add the function to UNIT_PICK_ALLOW_LIST with the reason"
      });
    }

    for (const write of writes) {
      if (write.key in UNIT_WRITE_ALLOW_LIST) continue;
      if (write.region && resolving.has(write.region)) continue;
      violations.push({
        file,
        line: lineOf(contents, write.index),
        snippet: write.snippet,
        message:
          "This writes a serial unit: call resolveWorkUnit in the same function first, or add the function to UNIT_WRITE_ALLOW_LIST with the reason"
      });
    }
    return violations;
  }
});

/** The functions in scope (`file#function`) that write a unit: what an allow-list entry must still name. */
export function unitWriters(files: { file: string; contents: string }[]) {
  return [
    ...new Set(
      files
        .filter(({ file }) => SCOPE.test(file) && file !== RESOLVER)
        .flatMap(({ file, contents }) =>
          analyze(file, contents).writes.map((w) => w.key)
        )
    )
  ].sort();
}

/** The functions in scope (`file#function`) that test a unit's state outside the resolver. */
export function unitPickers(files: { file: string; contents: string }[]) {
  return [
    ...new Set(
      files
        .filter(({ file }) => SCOPE.test(file) && file !== RESOLVER)
        .flatMap(({ file, contents }) =>
          analyze(file, contents).picks.map((p) => p.key)
        )
    )
  ].sort();
}

/**
 * An UPDATE that moves a row's lifecycle status must check the status it moves
 * FROM in the same statement, or hold the row lock while it decides.
 *
 * The shipped bug: the code reads the row, checks its status in JavaScript (or
 * not at all), then updates the row by `id` alone. Between the read and the
 * UPDATE another request moves the row, and the UPDATE overwrites that move.
 *  - `lockAccountingPeriod` / `unlockAccountingPeriod` (fixed in de82a88cc6):
 *    an unlock queued behind a close set the closed period back to Open.
 *  - the quote-to-order conversion in the `convert` edge function (2c9ef0dd8f):
 *    a replayed accept made a second sales order from an Ordered quote.
 *  - the receipt post (bbe8dfd6a9): a void between the check and the update
 *    was flipped back to Pending and posted.
 *  - the sales invoice void (578c411ffe): it locked the invoice
 *    (`.select("id")…forUpdate()`) and never read its status under the lock,
 *    so a second void waited for the first and then reversed it again.
 *
 * A write is flagged when its row sets a lifecycle status column — an
 * enum-typed column named `status` or `…Status` on that table, read from the
 * generated types, less `NOT_LIFECYCLE_ENUMS` — and
 *  - none of the statement's predicates names that column (Kysely
 *    `.where("status", …)`, supabase `.eq/.neq/.in/.is/.not/.match`, the
 *    `updateRows` filter, also when added later to a builder held in a
 *    variable), and
 *  - none names another column the same UPDATE changes (`.set({ status,
 *    salesInvoiceLineId: null }).where("salesInvoiceLineId", "in", ids)` is a
 *    claim on that column: a second run matches nothing), and
 *  - the function has not locked a row of that table before the write
 *    (`.selectFrom(t)…forUpdate()` / `.forNoKeyUpdate()`, raw SQL `FOR UPDATE`,
 *    or a call to a function in the same file that does) AND read the column
 *    under that lock: the locked select reads it (`.select("status")`,
 *    `.select(["id", "status"])`, `selectAll()`), the locked row's local reads
 *    it later (`locked?.status`), or a later select of the table does. A lock
 *    that reads only `id` waits for the other writer and then overwrites it.
 *    The lock is per table, not per row: the check cannot see which id was
 *    locked, nor that the code compares the status it read.
 *
 * `updateRowsById` has no predicate of its own, so a status it writes passes
 * only under a lock.
 *
 * The snippet is `<function>: <table>.<column>`, with no line. So a new
 * unguarded write in a function and table that are already baselined is
 * grandfathered too. For example, the `postSalesInvoice: salesInvoice.status`
 * entry, baselined for the post branch, also covers its void branch.
 *
 * Two baselined sites need their reason:
 *  - `activate` is a false positive. The agreement's lock and Draft check
 *    guard its rental lines.
 *  - the accounting providers' `upsertLocal` functions mirror a status the
 *    remote system already decided.
 *
 * The tests replay the parent revisions of de82a88cc6, 2c9ef0dd8f and
 * 578c411ffe. On main, 578c411ffe was squashed into b6ca51d4e1, so
 * `incidents` names both.
 *
 * Two more rules were measured and not built:
 *  - a claim that accepts `Pending` (`.in("status", ["Draft", "Pending"])`
 *    before it sets Pending). Every hit was a receipt, shipment or purchase
 *    invoice claim, whose posting re-checks the status under a lock. So every
 *    hit would be a false positive.
 *  - a side effect inside a transaction body. When measured, no
 *    `transaction().execute` body held a direct email, print, trigger or event
 *    call. The real side effects are calls into other functions, which a text
 *    check cannot follow.
 *
 * See `.claude/rules/concurrency.md`.
 */

const BLIND_LOCK_MESSAGE = (table: string, column: string) =>
  `This UPDATE sets ${table}.${column} after the function locked the row, but nothing reads ${column} under that lock, so a second request waits for the first and then repeats its change (the double invoice void, 578c411ffe). Select ${column} in the locked query (\`.select("${column}")…forUpdate()\`) and refuse when it is not the status you move from.`;

const STATUS_MESSAGE = (table: string, column: string) =>
  `This UPDATE sets ${table}.${column} with no predicate on ${column}, so a request that moved the row after you read it is overwritten. Check the status in the UPDATE (\`.eq("${column}", <expected>)\` / \`.where("${column}", "=", <expected>)\`) and refuse when no row changed, or lock the row FOR UPDATE and re-check it before the UPDATE.`;

/**
 * Enums named like a status that are not a lifecycle: a classification or a
 * measured result that is set to whatever is true now, never moved from one
 * expected state to the next, and the progress of a single background job.
 */
const NOT_LIFECYCLE_ENUMS = new Set([
  // Classification, edited freely.
  "flsaStatus",
  "itemRevisionStatus",
  // An on/off switch.
  "accountingPeriodStatus",
  "gaugeStatus",
  // A measured result.
  "inspectionStatus",
  "gaugeCalibrationStatus",
  // One job's own progress, written only by that job.
  "modelProcessingStatus",
  "documentExtractionStatus"
]);

/**
 * The enum-typed lifecycle columns per table: `status` and `…Status`. A
 * `…History` table is an append-only log, so it is left out.
 */
export function statusColumns(
  columnTypes: Map<string, Map<string, string>>
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [table, columns] of columnTypes) {
    if (/History$/.test(table)) continue;
    const status = [...columns]
      .filter(([name, type]) => {
        if (!/^(?:status|\w+Status)$/.test(name)) return false;
        const enumName =
          /^Database\["public"\]\["Enums"\]\["(\w+)"\](?: \| null)?$/.exec(
            type
          )?.[1];
        return enumName !== undefined && !NOT_LIFECYCLE_ENUMS.has(enumName);
      })
      .map(([name]) => name);
    if (status.length > 0) out.set(table, new Set(status));
  }
  return out;
}

const AUDIT_COLUMNS = new Set([
  "id",
  "companyId",
  "updatedAt",
  "updatedBy",
  "createdAt",
  "createdBy"
]);

const STATUS_ABOUT = {
  id: "status-write-guarded",
  description:
    "An UPDATE that sets a lifecycle status column carries a predicate on that column, or runs after the function locked the row — a status checked in code and written by id alone overwrites a concurrent change.",
  provenance: {
    deprecates:
      "reading a row's status, checking it in code, then updating the status by id alone (lockAccountingPeriod, the convert edge function's quote → Ordered, the invoice void, the receipt post)",
    replacedBy:
      'a guarded UPDATE (`.eq("status", <expected>)`) that refuses when no row changed, or a FOR UPDATE row lock and a re-check before the UPDATE',
    since: "de82a88cc6",
    incidents: ["de82a88cc6", "2c9ef0dd8f", "578c411ffe", "b6ca51d4e1"]
  }
};

/** What the two concurrency checks read in a file; no writes when it makes no UPDATE. */
function readRowWrites(contents: string): {
  text: string;
  regions: Region[];
  locks: RowLock[];
  writes: RowWrite[];
} {
  if (!/\.updateTable|\.update\s*\(|updateRows/.test(contents)) {
    return { text: contents, regions: [], locks: [], writes: [] };
  }
  const text = blankComments(contents);
  const regions = topLevelRegions(text);
  return {
    text,
    regions,
    locks: rowLocks(text),
    writes: rowWrites(text, regions)
  };
}

export function statusWriteGuarded(
  columnTypes: Map<string, Map<string, string>>
): ConformanceCheck {
  const columns = statusColumns(columnTypes);
  return {
    ...STATUS_ABOUT,
    scan(file, contents) {
      const { text, regions, locks, writes } = readRowWrites(contents);
      const violations: Violation[] = [];
      const seen = new Set<string>();
      for (const write of writes) {
        const lifecycle = columns.get(write.table);
        if (!lifecycle) continue;
        for (const field of write.fields) {
          if (!lifecycle.has(field.name)) continue;
          const at = `${field.index}:${write.table}.${field.name}`;
          if (seen.has(at)) continue;
          if (namesColumn(write.guards, field.name, write.alias, write.table)) {
            continue;
          }
          // A predicate on another column the same UPDATE changes is a claim
          // too: `.set({ status, salesInvoiceLineId: null })
          // .where("salesInvoiceLineId", "in", ids)` matches nothing the
          // second time.
          const claims = write.fields.some(
            (other) =>
              other.name !== field.name &&
              !AUDIT_COLUMNS.has(other.name) &&
              namesColumn(write.guards, other.name, write.alias, write.table)
          );
          if (claims) continue;
          const lock = lockedRead(
            text,
            regions,
            locks,
            write.index,
            write.table,
            field.name
          );
          if (lock === "read") continue;
          const fn = regionOf(regions, write.index)?.name ?? "<top level>";
          seen.add(at);
          violations.push({
            file,
            line: lineOf(text, field.index),
            snippet: `${fn}: ${write.table}.${field.name}`,
            message: (lock === "blind" ? BLIND_LOCK_MESSAGE : STATUS_MESSAGE)(
              write.table,
              field.name
            )
          });
        }
      }
      return violations;
    }
  };
}

export const statusWriteGuardedCheck = builtFrom(
  STATUS_ABOUT,
  loadDbTableColumnTypes,
  statusWriteGuarded
);

/**
 * A running total (`quantityIssued`, `quantityReceived`, …) must be added to in
 * SQL, or read under the lock that every other writer of it takes.
 *
 * The shipped bug: `issueJobOperationMaterials` read the job material, then
 * wrote `quantityIssued: round(Number(material.quantityIssued) + quantityToIssue)`
 * — an absolute value computed in JavaScript from the earlier read. Two
 * completions of one operation both read the same `quantityIssued` and both
 * issued (fixed in ca513209d8 by locking the operation first). The job's
 * backflush takes different locks, so a completion that read before a backflush
 * committed still issued the material again and its write replaced the
 * backflush's increment (fixed in f92d1b24fa by reading `quantityIssued` again
 * under the draw locks the backflush takes). The operation lock of ca513209d8
 * did not cover the backflush, which is why a lock on ANOTHER table does not
 * pass this check.
 *
 * A write is flagged when its row (read as `row-writes.ts` says) sets a counter
 * column of that table (`COUNTER_COLUMNS`, numeric in the generated types) to a
 * value that reads the same column back from JavaScript — `x.quantityIssued`,
 * directly or through up to `LOCAL_HOPS` locals (`const issued =
 * line.quantityIssued + q;` … `{ quantityIssued: issued }`). A value built with
 * `sql` or Kysely's `eb` is relative SQL and passes. The function passes when,
 * before the write, it
 *  - locked a row of the written table (`.selectFrom(t)…forUpdate()`, raw SQL
 *    `FOR UPDATE`, or a same-file helper that does), or
 *  - took a named lock (`lock…(` / `pg_advisory_xact_lock`) and only then read
 *    the counter from the table again (`.selectFrom(t)` naming the column, or
 *    `selectAll`) — the f92d1b24fa fix.
 * It cannot tell whether every other writer takes that lock; the formal models
 * in `packages/models` are where a protocol with several writers is checked.
 *
 * The test replays the parent revisions of both fixes. It passes the
 * f92d1b24fa fix, and still flags the ca513209d8 fix, because that one raced.
 *
 * The snippet is `<function>: <table>.<column>`, with no line. So a new
 * unguarded write in a function and table that are already baselined is
 * grandfathered too. The baseline holds the sites on main when the check was
 * added: mostly the order-line totals in the receipt, shipment and invoice
 * postings, and the job material issue, whose fix is on the models branch. See
 * `.claude/rules/concurrency.md`.
 */

export const COUNTER_COLUMNS = new Set([
  "quantityIssued",
  "quantityReceived",
  "quantityReceivedToInventory",
  "quantityInvoiced",
  "quantityShipped",
  "quantitySent",
  "quantityPicked",
  "quantityComplete",
  "quantityReturned",
  "quantityScrapped",
  "quantityReworked",
  "quantityPaidBack",
  "consumedQuantity",
  "appliedAmount"
]);

const COUNTER_MESSAGE = (table: string, column: string) =>
  `This sets ${table}.${column} to a total computed in JavaScript from an earlier read, so a writer that committed after the read is lost (counted twice, or overwritten). Write it relatively in SQL (sql\`"${column}" + \${delta}\`) or read it under the row lock (.selectFrom("${table}")…forUpdate()) before computing it.`;

const RELATIVE = /^(?:sql\b|eb\b|\(\s*eb\s*\)|\(?\s*\w*\s*\)?\s*=>)/;

/** Whether the value reads `column` back from a JavaScript object. */
function readsColumn(value: string, column: string): boolean {
  return new RegExp(
    `(?:\\??\\.\\s*${column}\\b|\\[\\s*["'\`]${column}["'\`]\\s*\\])`
  ).test(value);
}

/** How many locals deep a value is followed back to a read of the column. */
const LOCAL_HOPS = 3;

/**
 * Whether a local the value names was initialized, at its nearest declaration
 * before the write, from a read of `column` — directly or through further
 * locals (`const current = job.quantityShipped ?? 0; const next = current +
 * shipped;` … `{ quantityShipped: next }`).
 */
function readsColumnThroughLocal(
  text: string,
  region: Region | undefined,
  index: number,
  value: string,
  column: string,
  hops = LOCAL_HOPS,
  visited = new Set<string>()
): boolean {
  if (!region || hops === 0) return false;
  for (const [name] of value.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*\b/g)) {
    if (visited.has(name)) continue;
    visited.add(name);
    const initializer = nearestInitializer(text, region.start, index, name);
    if (!initializer) continue;
    if (readsColumn(initializer.text, column)) return true;
    if (
      readsColumnThroughLocal(
        text,
        region,
        initializer.start,
        initializer.text,
        column,
        hops - 1,
        visited
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether, before `index`, the function took a named lock and then read
 * `column` of `table` again: `lockUntrackedDraws(…)` then
 * `.selectFrom("jobMaterial").select(["id", "quantityIssued"])`.
 */
function rereadUnderNamedLock(
  text: string,
  region: Region | undefined,
  index: number,
  table: string,
  column: string
): boolean {
  if (!region) return false;
  const body = text.slice(region.start, index);
  const lock = [
    ...body.matchAll(/\b(?:lock[A-Z][\w$]*\s*\(|pg_advisory_xact_lock\b)/g)
  ][0];
  if (!lock) return false;
  const after = region.start + (lock.index ?? 0);
  for (const m of text.slice(after, index).matchAll(/\.selectFrom\s*\(/g)) {
    const open = after + (m.index ?? 0) + m[0].length - 1;
    const named = new RegExp(`^\\(\\s*["'\`]${table}(?:\\s+as\\s+\\w+)?["'\`]`);
    if (!named.test(text.slice(open, open + 200))) continue;
    const calls = chainCalls(text, matchBracket(text, open) + 1);
    if (calls.some((c) => c.name === "selectAll")) return true;
    const selected = calls
      .filter((c) => c.name === "select")
      .map((c) => text.slice(c.open, c.close + 1))
      .join(" ");
    if (new RegExp(`["'\`](?:\\w+\\.)?${column}["'\`]`).test(selected)) {
      return true;
    }
  }
  return false;
}

const COUNTER_ABOUT = {
  id: "counter-write-relative",
  description:
    "A running total is added to in SQL, or read under the row lock — an absolute value computed in JavaScript from an earlier read loses or doubles a concurrent writer's change.",
  provenance: {
    deprecates:
      "writing a counter as a JavaScript total of an earlier read (issueJobOperationMaterials' `quantityIssued: material.quantityIssued + quantityToIssue`)",
    replacedBy:
      'a relative SQL write (sql`"quantityIssued" + delta`), or a FOR UPDATE row lock taken before the counter is read',
    since: "ca513209d8, f92d1b24fa",
    incidents: ["ca513209d8", "f92d1b24fa"]
  }
};

export function counterWriteRelative(
  columnTypes: Map<string, Map<string, string>>
): ConformanceCheck {
  return {
    ...COUNTER_ABOUT,
    scan(file, contents) {
      const { text, regions, locks, writes } = readRowWrites(contents);
      const violations: Violation[] = [];
      const seen = new Set<string>();
      for (const write of writes) {
        const columns = columnTypes.get(write.table);
        if (!columns) continue;
        const region = regionOf(regions, write.index);
        for (const field of write.fields) {
          if (!COUNTER_COLUMNS.has(field.name)) continue;
          const at = `${field.index}:${write.table}.${field.name}`;
          if (seen.has(at)) continue;
          if (!/^number\b/.test(columns.get(field.name) ?? "")) continue;
          if (RELATIVE.test(field.value)) continue;
          const stale =
            readsColumn(field.value, field.name) ||
            readsColumnThroughLocal(
              text,
              region,
              field.index,
              field.value,
              field.name
            );
          if (!stale) continue;
          if (locksBefore(text, regions, locks, write.index).has(write.table)) {
            continue;
          }
          if (
            rereadUnderNamedLock(
              text,
              region,
              write.index,
              write.table,
              field.name
            )
          ) {
            continue;
          }
          seen.add(at);
          violations.push({
            file,
            line: lineOf(text, field.index),
            snippet: `${region?.name ?? "<top level>"}: ${write.table}.${field.name}`,
            message: COUNTER_MESSAGE(write.table, field.name)
          });
        }
      }
      return violations;
    }
  };
}

export const counterWriteRelativeCheck = builtFrom(
  COUNTER_ABOUT,
  loadDbTableColumnTypes,
  counterWriteRelative
);

/** The data-access checks, in the order they are written above. */
export const checks: Check[] = [
  noInlineUniqueViolation,
  noRawOrSearch,
  noPostgresChanges,
  noDbClientInService,
  noUnscopedKyselyWrite,
  noMissingAuditColumnCheck,
  stampMatchesColumns,
  noDiscardedQueryError,
  mesUnitWriteResolvesUnit,
  statusWriteGuardedCheck,
  counterWriteRelativeCheck
];
