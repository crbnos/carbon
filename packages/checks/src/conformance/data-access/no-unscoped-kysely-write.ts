// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { blankComments } from "../../sources/comments";
import { typescript } from "../../sources/inputs";
import { callArguments } from "../../sources/row-writes";
import { lineOf } from "../../sources/text";

// Every Kysely `updateTable` / `deleteFrom` must carry a `companyId` predicate.
//
// Kysely runs on the Postgres superuser connection (`getDatabaseClient()`), so
// RLS never applies to it — the `.where("companyId", …)` in the statement is
// the ONLY thing between a caller and another tenant's rows. The ids these
// statements key on usually come from the request body or the URL, and
// `requirePermissions` proves the caller may act in THEIR company, nothing
// about the ids. The public API makes that worse: it auto-publishes every
// `*.service.ts` export and hands a `db` parameter that same superuser client,
// so a service that updates by `id` alone is a cross-tenant write reachable
// with an ordinary API key. Ten drag-sort functions (`updateQuoteLineOrder`
// and friends) shipped exactly that way and were reported as a security
// disclosure; they now go through `updateSortOrder`
// (`apps/erp/app/modules/shared/sort-order.ts`).
//
// The rule is deliberately blunt: scope the WRITE itself, even when the ids
// were read under `companyId` a few lines up. A scoped read proves nothing
// once the code is refactored so the ids come from somewhere else, and the
// extra predicate costs nothing. `company` and `companySettings` have no
// `companyId` column — their `id` IS the tenant — so for them
// `.where("id", …)` is the tenant predicate. A write to either still needs it:
// an UPDATE of `companySettings` with no WHERE changes every tenant's
// settings. Tables shared by a company GROUP carry no `companyId` at all
// (`groupScopedTables`); their tenant key is `companyGroupId`, so a write to
// one must name that instead.
//
// Only a `.where` counts: a `companyId` in `.set()` scopes nothing. A link
// table with no `companyId` column passes when the statement scopes through
// its parent in a subquery, because the parent's `.where("companyId", …)` is
// part of the statement's text.
//
// The baselined sites write `companyGroup`, which has no `companyId` column:
// its `id` is the tenant-group key. They are the delete in the scheduled
// `purge-company` job, and the owner transfer in `setCompanyGroupOwner`, which
// keys on the caller's own group and its current owner.
//
// Scope: Node code that holds the superuser `db` — the ERP's modules and
// routes, the MES app and `packages/jobs`. The remaining Deno edge functions
// are out of scope
// (their document-level reads are scoped per
// `.claude/rules/workflow-edge-function.md`, and their follow-on writes key on
// ids from those reads), as is `packages/ee`, whose sync providers write
// global tables (`user`, `invite`) that have no `companyId`.
//
// A statement is the text from `.updateTable(`/`.deleteFrom(` to the first
// `.execute…(` / `.compile(` / `;` / `,` at the same bracket depth (or the
// bracket that closes around it), comments blanked.
// A statement built across several variables (`let q = …; q = q.where(…)`)
// ends at the first `;` and is flagged — inline it or baseline it.
//
// `updateRows` / `deleteRows` (`@carbon/database/rows`) are the same writes in
// another spelling: their last argument is the WHERE, and it must name
// `companyId`.
export const noUnscopedKyselyWrite = defineCheck({
  files: typescript,
  id: "no-unscoped-kysely-write",
  description:
    "Every Kysely updateTable/deleteFrom in app/jobs code carries a companyId predicate — Kysely bypasses RLS, so the statement's own WHERE is the only tenant boundary.",
  provenance: {
    deprecates:
      'a Kysely write keyed by id alone (e.g. updateQuoteLineOrder\'s `.where("id", "=", id)`), reachable cross-tenant through the public API\'s superuser `db`',
    replacedBy:
      '.where("companyId", "=", companyId) on every updateTable/deleteFrom; drag-sorts go through updateSortOrder in modules/shared/sort-order.ts'
  },
  rule() {
    const unscopedMessage =
      'Kysely bypasses RLS: this updateTable/deleteFrom has no companyId predicate, so ids from the request can reach another tenant\'s rows. Add .where("companyId", "=", companyId) to the statement.';

    const scopedPrefixes = [
      "apps/erp/app/modules/",
      "apps/erp/app/routes/",
      "apps/mes/app/",
      "packages/jobs/src/"
    ];

    /** Tables whose own `id` is the tenant key: `.where("id", …)` scopes them. */
    const idKeyedTenantTables = new Set(["company", "companySettings"]);

    /** Tables keyed by user alone. */
    const exemptTables = new Set(["userPermission"]);

    /**
     * Tables with no `companyId` column, shared by every company in a group. A
     * `companyGroupId` predicate is their tenant boundary. Only add a table that
     * genuinely lacks `companyId` — on any other table a group predicate is wider
     * than the tenant.
     */
    const groupScopedTables = new Set(["account", "currency"]);

    const write = /\.(updateTable|deleteFrom)\s*\(/g;
    const companyPredicate =
      /\.where(?:Ref)?\s*\(\s*["'`](?:\w+\.)?companyId["'`]/;
    const idPredicate = /\.where(?:Ref)?\s*\(\s*["'`](?:\w+\.)?id["'`]/;
    const companyGroupPredicate =
      /\.where(?:Ref)?\s*\(\s*["'`](?:\w+\.)?companyGroupId["'`]/;
    const statementEnd = /^\.(?:execute\w*|compile)\s*\(/;
    const rowsWrite = /\b(updateRows|deleteRows)\s*\(/g;
    const rowsMessage =
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
          if (ch === "." && statementEnd.test(text.slice(i, i + 40))) {
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

    return (file, contents) => {
      if (!scopedPrefixes.some((prefix) => file.startsWith(prefix))) return [];
      if (!/\.updateTable|\.deleteFrom|updateRows|deleteRows/.test(contents)) {
        return [];
      }

      const text = blankComments(contents);
      const violations: Violation[] = [];
      for (const m of text.matchAll(write)) {
        const start = m.index ?? 0;
        const openParen = start + m[0].length - 1;
        const table = literalTable(text, openParen);
        if (table && exemptTables.has(table)) continue;

        const statement = statementFrom(text, start + 1);
        if (companyPredicate.test(statement)) continue;
        if (
          table &&
          idKeyedTenantTables.has(table) &&
          idPredicate.test(statement)
        ) {
          continue;
        }
        if (
          table &&
          groupScopedTables.has(table) &&
          companyGroupPredicate.test(statement)
        ) {
          continue;
        }

        const call = text.slice(start, text.indexOf(")", openParen) + 1);
        violations.push({
          file,
          line: lineOf(text, start),
          snippet: call.length <= 80 ? call : m[0],
          message: unscopedMessage
        });
      }
      for (const m of text.matchAll(rowsWrite)) {
        const start = m.index ?? 0;
        const args = callArguments(text, start + m[0].length - 1).map(
          (arg) => arg.text
        );
        if (args.length < 3) continue;
        const table = args[1]?.trim().replace(/^["'`]|["'`]$/g, "");
        if (table && exemptTables.has(table)) continue;
        const filter = args[args.length - 1] ?? "";
        if (/\bcompanyId\b/.test(filter)) continue;
        if (
          table &&
          idKeyedTenantTables.has(table) &&
          /(?:^|[{,\s])id\b/.test(filter)
        ) {
          continue;
        }
        violations.push({
          file,
          line: lineOf(text, start),
          snippet: `${m[1]}(…, ${args[1]?.trim()}, …)`,
          message: rowsMessage
        });
      }
      return violations;
    };
  }
});
