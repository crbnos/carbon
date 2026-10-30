// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Calls every READ tool for real: this branch's dispatcher and services, a
 * signed-in user's client (so row-level security applies), and the data of a
 * seeded company on a running local stack. Unit tests stand services in; this
 * is the only place a tool is actually run end to end.
 *
 * Only READ tools are called. The generator refuses to publish one that writes,
 * in TypeScript or through a SQL function, so the sweep cannot change data.
 *
 * Run it with `pnpm sweep:tools` (see `test/sweep/README.md`). It writes a
 * report and fails when a tool errors that the baseline does not list, when a
 * tool it lists now passes, or when a tool could not be called at all.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getUserScopedClient } from "@carbon/auth/client.server";
import { today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getUserClaims } from "@carbon/auth/users.server";
import { scopesFromPermissions } from "~/routes/api+/v1+/lib/base.server";
import { callOperation } from "~/routes/api+/v1+/lib/call.server";
import { OPERATIONS } from "~/routes/api+/v1+/lib/operations.server";
import { getDatabaseClient } from "~/services/database.server";
import { publishedParamFilters } from "../../../../scripts/lib/service-ast";
import {
  type Column,
  consensusByName,
  type Planned,
  planInputs,
  usesNames
} from "./inputs";
import { givenInputs } from "./read-tools.inputs";
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
const BASELINE = path.join(HERE, "read-tools.baseline.json");
const REPORT =
  process.env.CARBON_SWEEP_REPORT ?? path.join(HERE, ".report/read-tools.json");
/** How many real values of an argument are tried before "no row matches" stands. */
const CANDIDATES = 12;

type Outcome =
  | { status: "ok"; rows: number | null; ms: number }
  | { status: "failed"; error: string; ms: number }
  /** The tool ran and said no row matches what it was given — an item that is
   *  not a tool, for `getTool`; a date no period covers. A tool that takes no
   *  arguments has nothing to blame, so the same answer there is `failed`. */
  | { status: "not-found"; ms: number }
  | { status: "not-called"; reason: string };

interface Entry {
  tool: string;
  args: Record<string, unknown>;
  /** Arguments taken from a parameter NAME, not from the tool's own body. */
  byName: string[];
  /** Arguments that name no real row: the company has none to take one from,
   *  so the tool was asked for a row that does not exist. */
  placeholder: string[];
  outcome: Outcome;
}

const db = getDatabaseClient();

/**
 * Existing values of a column, read as the user: ids the caller could really
 * have got from a list, so row-level security cannot be why a call by one
 * finds nothing. Several, because the first may not fit the tool — an item
 * that is not a tool, for `getTool`.
 */
function sampler(client: SupabaseClient, companyId: string) {
  const cache = new Map<string, Promise<unknown[]>>();
  const read = async ({ table, column }: Column): Promise<unknown[]> => {
    const query = () =>
      client
        .from(table)
        .select(column)
        .not(column, "is", null)
        .limit(CANDIDATES * 8);
    let found = await query().eq("companyId", companyId);
    // 42703: no companyId column — a table shared across companies.
    if (found.error?.code === "42703") found = await query();
    if (found.error) throw new Error(found.error.message);
    const rows = found.data as unknown as Array<Record<string, unknown>> | null;
    const distinct = new Map<string, unknown>();
    for (const row of rows ?? []) {
      distinct.set(JSON.stringify(row[column]), row[column]);
    }
    return [...distinct.values()].slice(0, CANDIDATES);
  };
  return (from: Column) => {
    const key = `${from.table}.${from.column}`;
    const cached = cache.get(key) ?? read(from);
    cache.set(key, cached);
    return cached;
  };
}

/** A planned argument that could not be given a value, and why. */
class NoValue extends Error {}

/**
 * The plan's arguments as real values, one set per candidate: set `n` uses the
 * `n`th value of every sampled column (the last one when a column has fewer).
 */
async function resolve(
  plan: Record<string, Planned>,
  sample: (from: Column) => Promise<unknown[]>,
  placeholder: (from: Column) => unknown
): Promise<{ candidates: Array<Record<string, unknown>>; placeholder: string[] }> {
  let sets = 1;
  const unmatched: string[] = [];
  const sampled = new Map<Planned, unknown[]>();
  // Lists with nothing to sample and no single value to stand in: sent empty.
  const empty = new Set<Planned>();
  const collect = async (name: string, planned: Planned): Promise<void> => {
    if (planned.kind === "object") {
      for (const [field, inner] of Object.entries(planned.fields)) {
        await collect(`${name}.${field}`, inner);
      }
      return;
    }
    if (planned.kind !== "sample") return;
    for (const from of planned.from) {
      let values: unknown[];
      try {
        values = await sample(from);
      } catch {
        // Not a column this user can read, or not a column at all: try the next.
        continue;
      }
      if (values.length > 0) {
        sampled.set(planned, values);
        sets = Math.max(sets, values.length);
        return;
      }
    }
    for (const from of planned.from) {
      const none = placeholder(from);
      if (none !== undefined) {
        sampled.set(planned, [none]);
        unmatched.push(name);
        return;
      }
    }
    if (planned.many) {
      empty.add(planned);
      unmatched.push(name);
      return;
    }
    const tried = planned.from.map((from) => `${from.table}.${from.column}`);
    throw new NoValue(`no rows to take ${name} from (${tried.join(", ")})`);
  };
  for (const [name, planned] of Object.entries(plan)) {
    await collect(name, planned);
  }

  const build = (planned: Planned, index: number): unknown => {
    if (planned.kind === "value") return planned.value;
    if (planned.kind === "object") {
      return Object.fromEntries(
        Object.entries(planned.fields).map(([field, inner]) => [
          field,
          build(inner, index)
        ])
      );
    }
    if (empty.has(planned)) return [];
    const values = sampled.get(planned) as unknown[];
    const value = values[Math.min(index, values.length - 1)];
    return planned.many ? [value] : value;
  };
  const candidates = Array.from({ length: sets }, (_, index) =>
    Object.fromEntries(
      Object.entries(plan).map(([name, planned]) => [name, build(planned, index)])
    )
  );
  return { candidates, placeholder: unmatched };
}

function rowsOf(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  return data === null || data === undefined ? 0 : null;
}

describe("every read tool, against real data", () => {
  it("answers without an error", async () => {
    const drift = await refuseDrift(db);
    const { companyId, userId } = await target(db);
    const companyGroupId = await companyGroupOf(db, companyId);

    // The sweep user calls as an OAuth connector would: gated on their own permissions.
    const claims = await getUserClaims(userId, companyId);
    const scopes = scopesFromPermissions(claims.permissions, companyId);

    const reads = OPERATIONS.filter((tool) => tool.classification === "READ");
    const filtersByTool = publishedParamFilters();
    const { tables, types, enums } = await loadSchema(db);
    const knowledge = {
      consensus: consensusByName([...filtersByTool.values()].flat()),
      tables
    };
    const sample = sampler(await getUserScopedClient(userId), companyId);
    const day = today("UTC").toString();
    const placeholder = placeholders(types, enums, day);
    const given = givenInputs(day);

    const entries: Entry[] = [];
    for (const tool of reads) {
      const plan = planInputs(
        tool.schema as Parameters<typeof planInputs>[0],
        filtersByTool.get(tool.name) ?? [],
        knowledge,
        day
      );
      const stated = given[tool.name] ?? {};
      Object.assign(plan.args, stated);
      plan.missing = plan.missing.filter(
        (missing) => !((missing.split(".")[0] ?? "") in stated)
      );
      const entry: Entry = {
        tool: tool.name,
        args: {},
        byName: Object.entries(plan.args)
          .filter(([, planned]) => usesNames(planned))
          .map(([name]) => name),
        placeholder: [],
        outcome: { status: "not-called", reason: "" }
      };
      entries.push(entry);

      if (plan.missing.length > 0) {
        entry.outcome = {
          status: "not-called",
          reason: `no value for ${plan.missing.join(", ")}`
        };
        continue;
      }

      let candidates: Array<Record<string, unknown>>;
      try {
        const resolved = await resolve(plan.args, sample, placeholder);
        candidates = resolved.candidates;
        entry.placeholder = resolved.placeholder;
      } catch (error) {
        if (!(error instanceof NoValue)) throw error;
        entry.outcome = { status: "not-called", reason: error.message };
        continue;
      }

      // "No row matches" with one real id may only mean the id does not fit, so
      // the next is tried; any other answer, good or bad, is the tool's answer.
      for (const args of candidates) {
        entry.args = args;
        const started = performance.now();
        try {
          // A fresh token per call: the sweep outlives a user token's five minutes.
          const client = await getUserScopedClient(userId);
          const result = await withTimeout(
            callOperation(
              tool.name,
              {
                client,
                userId,
                companyId,
                companyGroupId,
                authKind: "oauth",
                scopes
              },
              args
            )
          );
          if (!result.success) {
            // A single-row read that matched no row: try the next candidate.
            if (result.category === "notFound" && Object.keys(args).length > 0) {
              entry.outcome = { status: "not-found", ms: Math.round(performance.now() - started) };
              continue;
            }
            throw new Error(result.error);
          }
          entry.outcome = {
            status: "ok",
            rows: rowsOf(result.data),
            ms: Math.round(performance.now() - started)
          };
          break;
        } catch (error) {
          const ms = Math.round(performance.now() - started);
          entry.outcome = { status: "failed", error: describeError(error), ms };
          break;
        }
      }
    }

    const failed = entries.filter((entry) => entry.outcome.status === "failed");
    const summary = {
      company: companyId,
      drift,
      tools: entries.length,
      ok: entries.filter((entry) => entry.outcome.status === "ok").length,
      // Of those, the ones asked for a row that does not exist.
      okWithoutARow: entries.filter(
        (entry) => entry.outcome.status === "ok" && entry.placeholder.length > 0
      ).length,
      failed: failed.length,
      notFound: entries.filter((entry) => entry.outcome.status === "not-found")
        .length,
      notCalled: entries.filter((entry) => entry.outcome.status === "not-called")
        .length
    };
    mkdirSync(path.dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, `${JSON.stringify({ summary, entries }, null, 1)}\n`);
    console.log("read-tool sweep:", JSON.stringify(summary), "→", REPORT);

    const failures = Object.fromEntries(
      failed.map((entry) => [
        entry.tool,
        (entry.outcome as { error: string }).error
      ])
    );
    if (process.env.CARBON_SWEEP_UPDATE === "1") {
      writeFileSync(BASELINE, `${JSON.stringify(failures, null, 2)}\n`);
      return;
    }

    const known: Record<string, string> = existsSync(BASELINE)
      ? JSON.parse(readFileSync(BASELINE, "utf8"))
      : {};
    const called = new Set(
      entries
        .filter((entry) => entry.outcome.status !== "not-called")
        .map((entry) => entry.tool)
    );
    // A tool that was not called was not checked, and would pass by being
    // skipped: an argument that stops being plannable must not go unnoticed.
    expect(
      entries
        .filter((entry) => entry.outcome.status === "not-called")
        .map(
          (entry) =>
            `${entry.tool}: ${(entry.outcome as { reason: string }).reason}`
        ),
      "read tools that were not called — give the argument a value in read-tools.inputs.ts"
    ).toEqual([]);
    // New: failing now, not known to. Fixed: known to fail, called, and passing.
    expect(
      Object.keys(failures).filter((tool) => !(tool in known)),
      "tools that fail now and are not in the baseline"
    ).toEqual([]);
    expect(
      Object.keys(known).filter((tool) => called.has(tool) && !(tool in failures)),
      "tools the baseline lists as failing that now pass — remove them from it"
    ).toEqual([]);
  });
});
