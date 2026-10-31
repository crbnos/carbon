// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Calls every published update and delete for a record that does not exist,
 * as a signed-in user on a running local stack, the way a route calls it
 * (`toResult`, which is what the toast reads). Each one must refuse, and an
 * `internal` refusal must say why (`reason`): a write that changed no row and
 * answered success is the silent failure `requireAffected` exists to catch.
 *
 * Every argument that names a record is a value no row has, so the sweep
 * changes nothing. A tool with no such argument would act on real data and is
 * not called. Afterwards every table is searched for the marker text, and each
 * company table's row count and latest update are compared with before, so a
 * tool that wrote anything for a record that does not exist is reported.
 *
 * Run it with `pnpm sweep:tools` (see `test/sweep/README.md`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type ServiceFn, toResult } from "@carbon/api/service-fn.server";
import { getUserScopedClient } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { today } from "@internationalized/date";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { router } from "~/modules/router.server";
import { contextFor } from "~/modules/service-context.server";
import {
  OPERATIONS,
  operationId
} from "~/routes/api+/v1+/lib/operations.server";
import { getDatabaseClient } from "~/services/database.server";
import { publishedParamFilters } from "../../../../scripts/lib/service-ast";
import { type Column, consensusByName, type Planned, planInputs } from "./inputs";
import {
  companyGroupOf,
  describeError,
  loadSchema,
  placeholders,
  refuseDrift,
  target,
  withTimeout
} from "./shared";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASELINE = path.join(HERE, "write-refusals.baseline.json");
const REPORT =
  process.env.CARBON_SWEEP_WRITE_REPORT ??
  path.join(HERE, ".report/write-refusals.json");
const MARKER = "sweep-write-no-such-row";
// MRP rewrites these on every run, and its cron runs whatever the sweep does.
const REGENERATED = new Set([
  "demandActual",
  "demandForecast",
  "demandForecastSource",
  "planningAction",
  "supplyActual",
  "supplyForecast"
]);
// Verbs that change a record that already exists. A create given a record
// that does not exist could still insert a row, so creates are not called.
// Tools known to save something for a record that does not exist: calling
// them would write. Each is a bug to fix, then remove from here.
const WRITES_FOR_NOTHING: Record<string, string> = {
  settings_assignPrinter:
    "saves a printer assignment for a location that does not exist"
};
const CHANGES_A_RECORD =
  /^(delete|update|set|remove|cancel|close|reopen|archive|activate|deactivate|dismiss|assign|unassign|clear|rename|move|reorder|unrelease|toggle|mark)/;

type Outcome =
  | {
      status: "refused";
      category: string;
      message: string;
      title?: string;
      reason?: string;
    }
  | { status: "succeeded" }
  | { status: "threw"; error: string }
  | { status: "not-called"; reason: string };

interface Entry {
  tool: string;
  args: Record<string, unknown>;
  outcome: Outcome;
}

interface Baseline {
  /** Tools that answer success for a record that does not exist, and why that is right. */
  succeeds: Record<string, string>;
  noReason: Record<string, string>;
  notCalled: Record<string, string>;
}

const db = getDatabaseClient();

/** The plan with every record argument set to a value no row has. */
function fakeArgs(
  plan: Record<string, Planned>,
  none: (from: Column) => unknown
): { args: Record<string, unknown>; records: number } | { missing: string } {
  let records = 0;
  let missing: string | null = null;
  const build = (name: string, planned: Planned): unknown => {
    if (planned.kind === "value") return planned.value;
    if (planned.kind === "object") {
      return Object.fromEntries(
        Object.entries(planned.fields).map(([field, inner]) => [
          field,
          build(`${name}.${field}`, inner)
        ])
      );
    }
    const value = planned.from.map(none).find((v) => v !== undefined);
    if (value === undefined) {
      missing ??= name;
      return undefined;
    }
    records += 1;
    return planned.many ? [value] : value;
  };
  const args = Object.fromEntries(
    Object.entries(plan).map(([name, planned]) => [name, build(name, planned)])
  );
  return missing ? { missing } : { args, records };
}

async function companyTables(types: Map<string, string>) {
  const baseTables = await sql<{ table: string }>`
    select table_name as "table" from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`.execute(db);
  return baseTables.rows
    .map(({ table }) => table)
    .filter((table) => types.has(`${table}.companyId`));
}

/** Each company table's row count and latest `updatedAt`, to compare after the sweep. */
async function fingerprint(
  companyId: string,
  tables: string[],
  types: Map<string, string>
) {
  const prints = new Map<string, string>();
  for (const table of tables) {
    const latest = types.has(`${table}.updatedAt`)
      ? sql`max(${sql.ref("updatedAt")})::text`
      : sql`null`;
    const found = await sql<{ n: number; latest: string | null }>`
      select count(*)::int as n, ${latest} as latest from ${sql.table(table)}
      where ${sql.ref("companyId")} = ${companyId}`.execute(db);
    const row = found.rows[0];
    prints.set(table, `${row?.n ?? 0} rows, updated ${row?.latest ?? "never"}`);
  }
  return prints;
}

const SEARCHED_TYPES = new Set(["text", "varchar", "citext", "json", "jsonb", "_text"]);

/**
 * Tables holding the marker in a text, list or JSON column: what a tool wrote
 * for a record that does not exist. Every table, since a write can land in one
 * with no `companyId` (settings keyed by the company's id).
 */
async function leakedRows(types: Map<string, string>) {
  const baseTables = await sql<{ table: string }>`
    select table_name as "table" from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`.execute(db);
  const searched = new Map<string, string[]>();
  for (const [key, type] of types) {
    if (!SEARCHED_TYPES.has(type)) continue;
    const [table, column] = key.split(".") as [string, string];
    searched.set(table, [...(searched.get(table) ?? []), column]);
  }
  const leaks: string[] = [];
  for (const { table } of baseTables.rows) {
    const columns = searched.get(table);
    if (!columns) continue;
    const found = await sql<{ n: number }>`
      select count(*)::int as n from ${sql.table(table)}
      where ${sql.join(
        columns.map(
          (column) => sql`${sql.ref(column)}::text like ${`%${MARKER}%`}`
        ),
        sql` or `
      )}`.execute(db);
    const n = found.rows[0]?.n ?? 0;
    if (n > 0) leaks.push(`${table}: ${n}`);
  }
  return leaks;
}

describe("every update and delete, for a record that does not exist", () => {
  it("refuses, and an internal refusal says why", async () => {
    const drift = await refuseDrift(db);
    const { companyId, userId } = await target(db);
    const companyGroupId = await companyGroupOf(db, companyId);
    const claims = await getUserClaims(userId, companyId);

    const writes = OPERATIONS.filter(
      (tool) =>
        tool.classification !== "READ" &&
        CHANGES_A_RECORD.test(operationId(tool))
    );
    const filtersByTool = publishedParamFilters();
    const { tables, types, enums } = await loadSchema(db);
    const knowledge = {
      consensus: consensusByName([...filtersByTool.values()].flat()),
      tables
    };
    const day = today("UTC").toString();
    const none = placeholders(types, enums, day, MARKER);
    const scanned = await companyTables(types);
    const before = await fingerprint(companyId, scanned, types);

    const entries: Entry[] = [];
    for (const tool of writes) {
      const entry: Entry = {
        tool: tool.name,
        args: {},
        outcome: { status: "not-called", reason: "" }
      };
      entries.push(entry);

      if (tool.name in WRITES_FOR_NOTHING) {
        entry.outcome = {
          status: "not-called",
          reason: `writes for nothing: ${WRITES_FOR_NOTHING[tool.name]}`
        };
        continue;
      }

      const plan = planInputs(
        tool.schema as Parameters<typeof planInputs>[0],
        filtersByTool.get(tool.name) ?? [],
        knowledge,
        day
      );
      if (plan.missing.length > 0) {
        entry.outcome = {
          status: "not-called",
          reason: `no value for ${plan.missing.join(", ")}`
        };
        continue;
      }
      const faked = fakeArgs(plan.args, none);
      if ("missing" in faked) {
        entry.outcome = {
          status: "not-called",
          reason: `no value that matches nothing for ${faked.missing}`
        };
        continue;
      }
      if (faked.records === 0) {
        entry.outcome = {
          status: "not-called",
          reason: "names no record, so it would change real data"
        };
        continue;
      }
      entry.args = faked.args;

      const fn = (
        router as unknown as Record<
          string,
          Record<string, ServiceFn<z.ZodType, unknown>>
        >
      )[tool.module]?.[operationId(tool)];
      if (!fn) {
        entry.outcome = { status: "not-called", reason: "not in the router" };
        continue;
      }
      try {
        // A fresh token per call: the sweep outlives a user token's five minutes.
        const client = await getUserScopedClient(userId);
        const ctx = contextFor({
          kind: "user",
          userId,
          permissions: claims.permissions,
          companyId,
          companyGroupId,
          client
        });
        const result = await withTimeout(fn(ctx, faked.args).then(toResult));
        const error = result.error as {
          category: string;
          message: string;
          title?: string;
          reason?: { code: string };
        } | null;
        entry.outcome = error
          ? {
              status: "refused",
              category: error.category,
              message: error.message,
              ...(error.title && { title: error.title }),
              ...(error.reason && { reason: error.reason.code })
            }
          : { status: "succeeded" };
      } catch (error) {
        entry.outcome = { status: "threw", error: describeError(error) };
      }
    }

    const leaks = await leakedRows(types);
    const after = await fingerprint(companyId, scanned, types);
    const changed = scanned
      .filter((table) => !REGENERATED.has(table))
      .filter((table) => before.get(table) !== after.get(table))
      .map((table) => `${table}: ${before.get(table)} → ${after.get(table)}`);
    const of = (status: Outcome["status"]) =>
      entries.filter((entry) => entry.outcome.status === status);
    const refused = of("refused");
    const observed: Baseline = {
      succeeds: Object.fromEntries(
        of("succeeded").map((entry) => [entry.tool, "answers success"])
      ),
      noReason: Object.fromEntries(
        refused
          .filter(
            (entry) =>
              entry.outcome.status === "refused" &&
              entry.outcome.category === "internal" &&
              !entry.outcome.reason
          )
          .map((entry) => [
            entry.tool,
            (entry.outcome as { message: string }).message
          ])
      ),
      notCalled: Object.fromEntries(
        of("not-called").map((entry) => [
          entry.tool,
          (entry.outcome as { reason: string }).reason
        ])
      )
    };
    const reasons: Record<string, number> = {};
    for (const entry of refused) {
      const code =
        entry.outcome.status === "refused"
          ? (entry.outcome.reason ?? `(${entry.outcome.category})`)
          : "";
      reasons[code] = (reasons[code] ?? 0) + 1;
    }
    const summary = {
      company: companyId,
      drift,
      tools: entries.length,
      refused: refused.length,
      reasons,
      succeeded: of("succeeded").length,
      threw: of("threw").length,
      notCalled: of("not-called").length,
      leaks,
      changed
    };
    mkdirSync(path.dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, `${JSON.stringify({ summary, entries }, null, 1)}\n`);
    console.log("write-refusal sweep:", JSON.stringify(summary), "→", REPORT);

    const known: Baseline = existsSync(BASELINE)
      ? JSON.parse(readFileSync(BASELINE, "utf8"))
      : { succeeds: {}, noReason: {}, notCalled: {} };
    if (process.env.CARBON_SWEEP_UPDATE === "1") {
      // Keep the notes a person wrote for tools still in the same state.
      const keep = (now: Record<string, string>, before: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(now).map(([tool, text]) => [tool, before[tool] ?? text])
        );
      writeFileSync(
        BASELINE,
        `${JSON.stringify(
          {
            succeeds: keep(observed.succeeds, known.succeeds),
            noReason: keep(observed.noReason, known.noReason),
            notCalled: keep(observed.notCalled, known.notCalled)
          },
          null,
          2
        )}\n`
      );
      return;
    }

    expect(leaks, "rows written for a record that does not exist").toEqual([]);
    expect(
      changed,
      "company tables that changed during the sweep (a background job, or a tool that wrote)"
    ).toEqual([]);
    expect(
      of("threw").map(
        (entry) => `${entry.tool}: ${(entry.outcome as { error: string }).error}`
      ),
      "tools that threw instead of returning an error"
    ).toEqual([]);
    for (const key of ["succeeds", "noReason", "notCalled"] as const) {
      expect(
        Object.keys(observed[key]).filter((tool) => !(tool in known[key])),
        `${key}: new, not in write-refusals.baseline.json`
      ).toEqual([]);
      expect(
        Object.keys(known[key]).filter((tool) => !(tool in observed[key])),
        `${key}: listed in write-refusals.baseline.json but fixed — remove them`
      ).toEqual([]);
    }
  });
});
