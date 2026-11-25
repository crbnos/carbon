// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Provenance, Violation } from "../check";
import { blankComments } from "../sources/comments";
import {
  type Call,
  callArguments,
  chainCalls,
  matchBracket,
  type Region,
  regionOf,
  topLevelRegions
} from "./row-writes";

/**
 * Every supabase-js `.from("<t>").update(…)` / `.delete()` on a table with a
 * `companyId` column filters on `companyId`.
 *
 * The supabase-js half of `no-unscoped-kysely-write`. A service-role client
 * (`getCarbonServiceRole()`, `ctx.asSystem.supabase`, an action with
 * `bypassRls`) does not apply RLS, so the write's own filters are the only
 * tenant boundary, and the ids they key on come from the URL or the body. An
 * RLS client is not enough either: a user who works in two companies may write
 * either company's rows while acting in one. The fixes this check names:
 *  - the receipt post (573bcf0079) set the receipt to Pending by `id` alone;
 *  - the sales invoice bulk update (0909321afd) rewrote `dateIssued` and
 *    `paymentTermId` by `id` alone;
 *  - the MES maintenance services (9ddb3bc295, a security disclosure) ended
 *    events, moved dispatches and deleted dispatch items by `id` alone;
 *  - the invoice shipment / delivery updates (89bdf0e27e) wrote by `id` alone,
 *    reachable through the API and MCP.
 *
 * Like the Kysely check, the rule is blunt: scope the WRITE, even when the id
 * was read under `companyId` a few lines up, or arrives from a parent that was.
 *
 * A write passes when a filter chained after `.update(`/`.delete(` names
 * `companyId`: `.eq` / `.in` / `.is` / `.filter("companyId", …)`, or a
 * `.match({ … companyId … })`. When the statement assigns the builder to a
 * local with no `await` (`let q = client.from("t").delete().eq(…)`), a filter
 * chained onto that local later in the same top-level function counts too
 * (`q = q.eq("companyId", companyId)`, `q.eq(…)`); nothing else across
 * statements is followed. The table must be a string literal and have a
 * `companyId` column in the generated types; `company`, `companySettings`
 * and the group-scoped tables (`account`, `currency`) have none and are out of
 * scope, as is a table named by a variable.
 *
 * `.upsert(` is out of scope: it is an INSERT … ON CONFLICT, so a filter after
 * it is never applied; its tenant key is the row's `companyId` and the
 * conflict target. Inserts and reads are out of scope.
 *
 * Scope: the same roots as `no-unscoped-kysely-write` — ERP modules and
 * routes, the MES app and `packages/jobs`. Edge functions and `packages/ee`
 * are out, for the reasons in that file's header.
 *
 * The snippet is `<function>: <table>.<update|delete>`, so a new unscoped
 * write in an already-baselined function and table is grandfathered with it,
 * and one in any other function is not.
 */

export const NO_UNSCOPED_SUPABASE_WRITE = "no-unscoped-supabase-write";

// Exported on its own because the check is built from the generated types:
// the provenance meta-test reads it without building the check.
export const NO_UNSCOPED_SUPABASE_WRITE_PROVENANCE: Provenance = {
  deprecates:
    'a supabase-js update/delete keyed by id (or a parent id) alone, e.g. the receipt post\'s `.update({ status: "Pending" }).eq("id", receiptId)`, which a service-role client runs against any company\'s row',
  replacedBy:
    '.eq("companyId", companyId) on every supabase-js update/delete of a company-scoped table',
  since: "573bcf0079",
  incidents: ["573bcf0079", "0909321afd", "9ddb3bc295", "89bdf0e27e"]
};

const MESSAGE = (table: string, verb: string) =>
  `This supabase-js ${verb} on ${table} has no companyId filter. A service-role client bypasses RLS, so an id from the request can reach another company's row. Add .eq("companyId", companyId) to the chain.`;

const SCOPED_PREFIXES = [
  "apps/erp/app/modules/",
  "apps/erp/app/routes/",
  "apps/mes/app/",
  "packages/jobs/src/"
];

const WRITES = new Set(["update", "delete"]);

/** Filters that name their column first: `.eq("companyId", …)`. */
const COLUMN_FILTERS = new Set(["eq", "in", "is", "filter"]);

/** The tables that carry a `companyId` column. */
export function companyScopedTables(
  columnTypes: Map<string, Map<string, string>>
): Set<string> {
  const out = new Set<string>();
  for (const [table, columns] of columnTypes) {
    if (columns.has("companyId")) out.add(table);
  }
  return out;
}

function namesCompanyId(text: string, call: Call): boolean {
  const args = callArguments(text, call.open);
  if (COLUMN_FILTERS.has(call.name)) {
    return /^\s*["'`]companyId["'`]\s*$/.test(args[0]?.text ?? "");
  }
  if (call.name === "match") {
    return /(?:^|[{,\s])["'`]?companyId\b/.test(args[0]?.text ?? "");
  }
  return false;
}

/**
 * The local the write's statement assigns the builder to, when it holds the
 * builder itself (no `await` between the `=` and the `.from(`).
 */
function heldBuilder(
  text: string,
  region: Region | undefined,
  index: number
): string | null {
  if (!region) return null;
  const head = text.slice(region.start, index);
  const start = Math.max(
    head.lastIndexOf(";"),
    head.lastIndexOf("{"),
    head.lastIndexOf("}")
  );
  const statement = head.slice(start + 1);
  const m =
    /^\s*(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=(?![=>])/.exec(
      statement
    );
  if (!m) return null;
  if (/\bawait\b/.test(statement.slice(m[0].length))) return null;
  return m[1] as string;
}

/** Whether a filter chained onto `name` later in the region names companyId. */
function laterScoped(
  text: string,
  region: Region,
  from: number,
  name: string
): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  const body = text.slice(from, region.end);
  for (const m of body.matchAll(new RegExp(`(?<![\\w$.])${escaped}\\b`, "g"))) {
    const after = from + (m.index ?? 0) + name.length;
    if (chainCalls(text, after).some((c) => namesCompanyId(text, c))) {
      return true;
    }
  }
  return false;
}

export function noUnscopedSupabaseWrite(
  columnTypes: Map<string, Map<string, string>>
): ConformanceCheck {
  const scoped = companyScopedTables(columnTypes);
  return {
    id: NO_UNSCOPED_SUPABASE_WRITE,
    description:
      "Every supabase-js update/delete of a company-scoped table in app/jobs code filters on companyId — a service-role client bypasses RLS, so the chain's own filters are the only tenant boundary.",
    provenance: NO_UNSCOPED_SUPABASE_WRITE_PROVENANCE,
    // The text every file this check flags contains.
    triggers: [".update(", ".delete("],
    scan(file, contents) {
      if (!SCOPED_PREFIXES.some((prefix) => file.startsWith(prefix))) return [];
      if (!/\.(?:update|delete)\s*\(/.test(contents)) return [];

      const text = blankComments(contents);
      const regions = topLevelRegions(text);
      const violations: Violation[] = [];
      for (const m of text.matchAll(/\.from\s*\(/g)) {
        const index = m.index ?? 0;
        // `client.storage.from("bucket")` is a storage bucket, not a table.
        if (/\bstorage\s*$/.test(text.slice(Math.max(0, index - 40), index))) {
          continue;
        }
        const open = index + m[0].length - 1;
        const table = /^\(\s*["'`](\w+)["'`]\s*\)/.exec(
          text.slice(open, open + 200)
        )?.[1];
        if (!table || !scoped.has(table)) continue;

        const calls = chainCalls(text, matchBracket(text, open) + 1);
        const write = calls[0];
        if (!write || !WRITES.has(write.name)) continue;
        if (calls.slice(1).some((c) => namesCompanyId(text, c))) continue;

        const region = regionOf(regions, index);
        const held = heldBuilder(text, region, index);
        if (
          held &&
          region &&
          laterScoped(
            text,
            region,
            (calls[calls.length - 1]?.close ?? open) + 1,
            held
          )
        ) {
          continue;
        }

        violations.push({
          file,
          line: text.slice(0, index).split("\n").length,
          snippet: `${region?.name ?? "<top level>"}: ${table}.${write.name}`,
          message: MESSAGE(table, write.name)
        });
      }
      return violations;
    }
  };
}
