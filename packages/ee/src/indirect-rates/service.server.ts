// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Server-only indirect rates AUTHORING and readers (Government Contracting 5b).
//
// The commercial LOCK: every authoring function and every run calls
// `requireEntitlement(..., "GOVERNMENT_CONTRACTING")` before it touches the
// database, so the gate sits on the commercial side of the license boundary.
// The readers read community tables and need no entitlement check.
//
// Reached only through `@carbon/ee/indirect-rates.server` (`./server.ts`).
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (Task 7, B2, B12)

import { posting } from "@carbon/api/postings.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime, formatPercent, formatQuantity } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { EntitlementError, requireEntitlement } from "../entitlements.server";
import {
  type BurdenBillingAdjustment,
  burdenBillingAdjustments,
  burdenCatchUp,
  computePoolRates,
  fiscalYearRange,
  type PoolDef,
  type PoolMapping,
  type PoolRateResult,
  periodRateFrom,
  projectBurdenTargets
} from "./compute";
import {
  loadAbsorbedOverhead,
  loadElementCells,
  loadGlCells,
  loadPostedBurden,
  loadRatePeriod
} from "./loaders.server";
import {
  type BaseBucket,
  type burdenSettingsValidator,
  type contractRateCeilingValidator,
  type IndirectRateType,
  type indirectPoolAccountValidator,
  type indirectPoolValidator,
  PROJECT_BASE_BUCKETS
} from "./models";

type Client = SupabaseClient<Database>;

const FEATURE = "GOVERNMENT_CONTRACTING" as const;

export const INDIRECT_POOL_IN_USE =
  "This pool has rates or burden. Deactivate it instead.";
export const INDIRECT_POOL_BASE_PROJECT_ACCOUNT =
  "Project accounts hold mixed cost. The base comes from the project ledger.";
export const INDIRECT_RATE_ACTUAL_REFUSED =
  "Actual rates come from the rate run. Enter a Provisional, Target or Final rate.";

/** A refusal in the `{ data, error }` shape the callers already read. */
function refuse(message: string) {
  return { data: null, error: { message } };
}

// -----------------------------------------------------------------------------
// Pools
// -----------------------------------------------------------------------------

export async function upsertIndirectPool(
  client: Client,
  input: z.infer<typeof indirectPoolValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id, ...fields } = input;
  await requireEntitlement(client, companyId, FEATURE);

  const values = {
    name: fields.name,
    poolType: fields.poolType,
    sequence: fields.sequence,
    baseType: fields.baseType,
    appliedAccountId: fields.appliedAccountId || null,
    appliesToProjects: fields.appliesToProjects,
    offsetAbsorbedOverhead: fields.offsetAbsorbedOverhead,
    active: fields.active
  };

  if (id) {
    return client
      .from("indirectPool")
      .update({
        ...values,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("indirectPool")
    .insert({ ...values, companyId, createdBy: userId })
    .select("id")
    .single();
}

export async function deleteIndirectPool(
  client: Client,
  { id, companyId }: { id: string; companyId: string }
) {
  await requireEntitlement(client, companyId, FEATURE);

  const [rates, burden] = await Promise.all([
    client
      .from("indirectRate")
      .select("id", { count: "exact", head: true })
      .eq("indirectPoolId", id)
      .eq("companyId", companyId),
    client
      .from("projectLedger")
      .select("id", { count: "exact", head: true })
      .eq("indirectPoolId", id)
      .eq("companyId", companyId)
  ]);
  if (rates.error) return refuse(rates.error.message);
  if (burden.error) return refuse(burden.error.message);
  if ((rates.count ?? 0) > 0 || (burden.count ?? 0) > 0) {
    return refuse(INDIRECT_POOL_IN_USE);
  }

  return client
    .from("indirectPool")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Pool accounts
// -----------------------------------------------------------------------------

export async function upsertIndirectPoolAccount(
  client: Client,
  input: z.infer<typeof indirectPoolAccountValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id, ...fields } = input;
  await requireEntitlement(client, companyId, FEATURE);

  // B2: the project accounts mix every project's labor and material, so a
  // pool base takes project cost from the project ledger instead.
  if (fields.role === "Base") {
    const defaults = await client
      .from("accountDefault")
      .select("projectExpenseAccount, projectWorkInProgressAccount")
      .eq("companyId", companyId)
      .maybeSingle();
    if (defaults.error) return refuse(defaults.error.message);
    const projectAccounts = [
      defaults.data?.projectExpenseAccount,
      defaults.data?.projectWorkInProgressAccount
    ].filter(Boolean);
    if (projectAccounts.includes(fields.accountId)) {
      return refuse(INDIRECT_POOL_BASE_PROJECT_ACCOUNT);
    }
  }

  const values = {
    indirectPoolId: fields.indirectPoolId,
    accountId: fields.accountId,
    dimensionId: fields.dimensionId || null,
    dimensionValueId: fields.dimensionValueId || null,
    role: fields.role
  };

  if (id) {
    return client
      .from("indirectPoolAccount")
      .update({
        ...values,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("indirectPoolAccount")
    .insert({ ...values, companyId, createdBy: userId })
    .select("id")
    .single();
}

export async function deleteIndirectPoolAccount(
  client: Client,
  { id, companyId }: { id: string; companyId: string }
) {
  await requireEntitlement(client, companyId, FEATURE);
  return client
    .from("indirectPoolAccount")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Rates
// -----------------------------------------------------------------------------

export type IndirectRateEntry = {
  companyId: string;
  userId: string;
  indirectPoolId: string;
  fiscalYear: number;
  fromPeriod: number;
  rateType: IndirectRateType;
  rate: number;
};

/** B12: a rate "from period N" is one row per period N to 12, period rate = YTD rate. */
export function indirectRateRows(entry: IndirectRateEntry) {
  const timestamp = datetime.timestamp();
  const rows: Database["public"]["Tables"]["indirectRate"]["Insert"][] = [];
  for (
    let periodNumber = entry.fromPeriod;
    periodNumber <= 12;
    periodNumber++
  ) {
    rows.push({
      companyId: entry.companyId,
      indirectPoolId: entry.indirectPoolId,
      fiscalYear: entry.fiscalYear,
      periodNumber,
      rateType: entry.rateType,
      periodRate: entry.rate,
      ytdRate: entry.rate,
      createdBy: entry.userId,
      updatedBy: entry.userId,
      updatedAt: timestamp
    });
  }
  return rows;
}

export async function setIndirectRate(
  client: Client,
  entry: IndirectRateEntry
) {
  await requireEntitlement(client, entry.companyId, FEATURE);
  if (entry.rateType === "Actual") return refuse(INDIRECT_RATE_ACTUAL_REFUSED);

  return client
    .from("indirectRate")
    .upsert(indirectRateRows(entry), {
      onConflict: "indirectPoolId,fiscalYear,periodNumber,rateType,companyId"
    })
    .select("id");
}

// -----------------------------------------------------------------------------
// Contract rate ceilings
// -----------------------------------------------------------------------------

export async function upsertContractRateCeiling(
  client: Client,
  input: z.infer<typeof contractRateCeilingValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id, ...fields } = input;
  await requireEntitlement(client, companyId, FEATURE);

  if (id) {
    return client
      .from("customerContractRateCeiling")
      .update({
        ...fields,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("customerContractRateCeiling")
    .insert({ ...fields, companyId, createdBy: userId })
    .select("id")
    .single();
}

export async function deleteContractRateCeiling(
  client: Client,
  { id, companyId }: { id: string; companyId: string }
) {
  await requireEntitlement(client, companyId, FEATURE);
  return client
    .from("customerContractRateCeiling")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Burden settings (B9)
// -----------------------------------------------------------------------------

export async function updateBurdenSettings(
  client: Client,
  input: z.infer<typeof burdenSettingsValidator> & {
    companyId: string;
    userId: string;
  }
) {
  // `companySettings` has no audit columns, so `userId` is not written.
  await requireEntitlement(client, input.companyId, FEATURE);
  return client
    .from("companySettings")
    .update({
      burdenRateType: input.burdenRateType,
      postAppliedBurden: input.postAppliedBurden
    })
    .eq("id", input.companyId)
    .select("id")
    .single();
}

// -----------------------------------------------------------------------------
// The rate run (Task 8)
// -----------------------------------------------------------------------------

/**
 * Computes the YTD Actual rate of every active pool for one accounting
 * period, and writes the Actual rates, the Statement of Indirect Expenses and
 * the period run in one transaction. Rates write no journal, so any period
 * state is accepted.
 */
export async function computeIndirectRates(
  db: Kysely<KyselyDatabase>,
  client: Client,
  {
    companyId,
    userId,
    accountingPeriodId
  }: { companyId: string; userId: string; accountingPeriodId: string }
): Promise<{ data: PoolRateResult[]; error: null }> {
  await requireEntitlement(client, companyId, FEATURE);

  const ratePeriod = await loadRatePeriod(db, {
    companyId,
    accountingPeriodId
  });
  const { fiscalYear, periodNumber, fyStart, periodEnd } = ratePeriod;

  const pools = await db
    .selectFrom("indirectPool")
    .select([
      "id",
      "name",
      "poolType",
      "sequence",
      "baseType",
      "appliesToProjects",
      "offsetAbsorbedOverhead"
    ])
    .where("companyId", "=", companyId)
    .where("active", "=", true)
    .execute();
  const poolIds = pools.map((p) => p.id);

  const mappings: PoolMapping[] =
    poolIds.length === 0
      ? []
      : await db
          .selectFrom("indirectPoolAccount")
          .select([
            "id",
            "indirectPoolId",
            "accountId",
            "dimensionId",
            "dimensionValueId",
            "role"
          ])
          .where("companyId", "=", companyId)
          .where("indirectPoolId", "in", poolIds)
          .execute();

  const range = { companyId, from: fyStart, to: periodEnd };
  const [glCells, elements, absorbed, previousRows] = await Promise.all([
    loadGlCells(db, { ...range, mappings }),
    loadElementCells(db, range),
    loadAbsorbedOverhead(db, range),
    periodNumber > 1 && poolIds.length > 0
      ? db
          .selectFrom("indirectRate")
          .select(["indirectPoolId", "poolCost", "baseAmount"])
          .where("companyId", "=", companyId)
          .where("fiscalYear", "=", fiscalYear)
          .where("periodNumber", "=", periodNumber - 1)
          .where("rateType", "=", "Actual")
          .where("indirectPoolId", "in", poolIds)
          .execute()
      : Promise.resolve([])
  ]);

  const results = computePoolRates({
    pools,
    mappings,
    glCells,
    elements,
    absorbedOverhead: absorbed.amount,
    absorbedOverheadAccountId: absorbed.accountId
  });

  const previousByPool = new Map(
    previousRows.map((row) => [
      row.indirectPoolId,
      {
        poolCost: Number(row.poolCost ?? 0),
        baseAmount: Number(row.baseAmount ?? 0)
      }
    ])
  );
  // Period 1 has no earlier period, so its period rate is its YTD rate. A
  // later period with no Actual row for the period before has no period rate.
  const periodRateOf = (result: PoolRateResult) => {
    if (periodNumber === 1) return periodRateFrom(result, null);
    const previous = previousByPool.get(result.indirectPoolId);
    return previous ? periodRateFrom(result, previous) : null;
  };

  const timestamp = datetime.timestamp();
  await db.transaction().execute(async (trx) => {
    if (results.length > 0) {
      await trx
        .insertInto("indirectRate")
        .values(
          results.map((result) => ({
            companyId,
            indirectPoolId: result.indirectPoolId,
            fiscalYear,
            periodNumber,
            rateType: "Actual" as const,
            periodRate: periodRateOf(result),
            ytdRate: result.ytdRate,
            poolCost: result.poolCost,
            unallowableCost: result.unallowableCost,
            baseAmount: result.baseAmount,
            createdBy: userId
          }))
        )
        .onConflict((oc) =>
          oc
            .columns([
              "indirectPoolId",
              "fiscalYear",
              "periodNumber",
              "rateType",
              "companyId"
            ])
            .doUpdateSet((eb) => ({
              periodRate: eb.ref("excluded.periodRate"),
              ytdRate: eb.ref("excluded.ytdRate"),
              poolCost: eb.ref("excluded.poolCost"),
              unallowableCost: eb.ref("excluded.unallowableCost"),
              baseAmount: eb.ref("excluded.baseAmount"),
              updatedBy: userId,
              updatedAt: timestamp
            }))
        )
        .execute();

      await trx
        .deleteFrom("indirectExpenseStatement")
        .where("companyId", "=", companyId)
        .where("fiscalYear", "=", fiscalYear)
        .where("periodNumber", "=", periodNumber)
        .where("indirectPoolId", "in", poolIds)
        .execute();

      const lines = results.flatMap((result) =>
        result.lines
          // A line other than Carried Burden needs an account (a CHECK).
          .filter(
            (line) =>
              line.lineType === "Carried Burden" || line.accountId !== null
          )
          .map((line) => ({
            companyId,
            indirectPoolId: result.indirectPoolId,
            fiscalYear,
            periodNumber,
            lineType: line.lineType,
            accountId: line.accountId,
            dimensionValueId: line.dimensionValueId,
            sourcePoolId: line.sourcePoolId,
            amount: line.amount,
            unallowableAmount: line.unallowableAmount,
            createdBy: userId
          }))
      );
      if (lines.length > 0) {
        await trx
          .insertInto("indirectExpenseStatement")
          .values(lines)
          .execute();
      }
    }

    await trx
      .insertInto("indirectRateRun")
      .values({
        companyId,
        accountingPeriodId,
        fiscalYear,
        periodNumber,
        ratesComputedAt: timestamp,
        error: null,
        createdBy: userId
      })
      .onConflict((oc) =>
        oc.columns(["accountingPeriodId", "companyId"]).doUpdateSet({
          fiscalYear,
          periodNumber,
          ratesComputedAt: timestamp,
          error: null,
          updatedBy: userId,
          updatedAt: timestamp
        })
      )
      .execute();
  });

  return { data: results, error: null };
}

// -----------------------------------------------------------------------------
// Burden and burden billing (Task 10)
// -----------------------------------------------------------------------------

export const BURDEN_PERIOD_NOT_LOCKED =
  "Lock the period before you compute burden.";

/** The most rows one `post-project-burden` call accepts. */
const BURDEN_ROWS_PER_CALL = 10000;
const BILLABLE_INSERT_BATCH = 1000;

type BurdenRateType = Exclude<IndirectRateType, "Target">;

type AppliedPool = PoolDef & { appliedAccountId: string | null };

/** The active pools that apply to projects, in sequence order. */
async function loadAppliedPools(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<AppliedPool[]> {
  const pools = await db
    .selectFrom("indirectPool")
    .select([
      "id",
      "name",
      "poolType",
      "sequence",
      "baseType",
      "appliesToProjects",
      "offsetAbsorbedOverhead",
      "appliedAccountId"
    ])
    .where("companyId", "=", companyId)
    .where("active", "=", true)
    .where("appliesToProjects", "=", true)
    .orderBy("sequence")
    .execute();
  return pools;
}

/** Inserts or updates the period's run row and returns its id. */
async function upsertRateRun(
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    userId,
    accountingPeriodId,
    fiscalYear,
    periodNumber
  }: {
    companyId: string;
    userId: string;
    accountingPeriodId: string;
    fiscalYear: number;
    periodNumber: number;
  }
): Promise<string> {
  const run = await db
    .insertInto("indirectRateRun")
    .values({
      companyId,
      accountingPeriodId,
      fiscalYear,
      periodNumber,
      createdBy: userId
    })
    .onConflict((oc) =>
      oc.columns(["accountingPeriodId", "companyId"]).doUpdateSet({
        fiscalYear,
        periodNumber,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  return run.id;
}

/**
 * Posts the YTD burden catch-up of one Locked period (B8, B10): for each
 * element of a burdened project, the target burden at the period's YTD rate
 * less the Burden rows the fiscal year already holds. The rows go through
 * the `post-project-burden` posting, which writes them and, when
 * `postAppliedBurden` is set, the applied burden journal.
 *
 * `rateType` defaults to `companySettings.burdenRateType`. A `rateType` of
 * Final is the year-end true-up: it reads the Final rate of period 12 of
 * `fiscalYear` (default: the period's own year), burdens the full fiscal year,
 * and posts into the given Locked period.
 */
export async function computeProjectBurden(
  db: Kysely<KyselyDatabase>,
  client: Client,
  {
    companyId,
    userId,
    accountingPeriodId,
    rateType,
    fiscalYear: trueUpYear
  }: {
    companyId: string;
    userId: string;
    accountingPeriodId: string;
    rateType?: BurdenRateType;
    fiscalYear?: number;
  }
): Promise<
  | {
      data: { indirectRateRunId: string; burdenRowCount: number };
      error: null;
    }
  | { data: null; error: { message: string } }
> {
  await requireEntitlement(client, companyId, FEATURE);

  const ratePeriod = await loadRatePeriod(db, {
    companyId,
    accountingPeriodId
  });
  if (ratePeriod.period.closeStatus !== "Locked") {
    return refuse(BURDEN_PERIOD_NOT_LOCKED);
  }

  const settings = await db
    .selectFrom("companySettings")
    .select(["burdenRateType", "postAppliedBurden"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  const type: BurdenRateType =
    rateType ?? (settings?.burdenRateType as BurdenRateType) ?? "Provisional";
  const isTrueUp = type === "Final";
  const fiscalYear = isTrueUp
    ? (trueUpYear ?? ratePeriod.fiscalYear)
    : ratePeriod.fiscalYear;
  const periodNumber = isTrueUp ? 12 : ratePeriod.periodNumber;

  const pools = await loadAppliedPools(db, companyId);
  const rateRows =
    pools.length === 0
      ? []
      : await db
          .selectFrom("indirectRate")
          .select(["indirectPoolId", "ytdRate"])
          .where("companyId", "=", companyId)
          .where("fiscalYear", "=", fiscalYear)
          .where("periodNumber", "=", periodNumber)
          .where("rateType", "=", type)
          .where(
            "indirectPoolId",
            "in",
            pools.map((pool) => pool.id)
          )
          .execute();
  const rates = new Map(
    rateRows.map((row) => [row.indirectPoolId, Number(row.ytdRate)])
  );
  const missing = pools.find((pool) => !rates.has(pool.id));
  if (missing) {
    return refuse(
      `No ${type} rate for ${missing.name} in FY${fiscalYear} period ${periodNumber}`
    );
  }

  // The true-up burdens the whole fiscal year; a period run burdens YTD.
  const fullYear = fiscalYearRange(fiscalYear, 12, ratePeriod.startMonth);
  const range = isTrueUp
    ? { from: fullYear.start, to: fullYear.periodEnd }
    : { from: ratePeriod.fyStart, to: ratePeriod.periodEnd };

  const [elements, posted] = await Promise.all([
    loadElementCells(db, { companyId, ...range }),
    loadPostedBurden(db, {
      companyId,
      fiscalYear,
      through: isTrueUp ? null : ratePeriod.periodEnd
    })
  ]);

  // An element with posted burden and no cost in the range still catches up
  // to zero.
  const elementKey = (row: {
    projectId: string;
    projectElementId: string | null;
  }) => `${row.projectId}|${row.projectElementId ?? ""}`;
  const appliedPoolIds = new Set(pools.map((pool) => pool.id));
  const allElements = new Map(elements.map((e) => [elementKey(e), e]));
  for (const row of posted) {
    if (!appliedPoolIds.has(row.indirectPoolId)) continue;
    if (allElements.has(elementKey(row))) continue;
    allElements.set(elementKey(row), {
      projectId: row.projectId,
      projectElementId: row.projectElementId,
      costObjective: "Direct",
      buckets: {},
      absorbedOverhead: 0
    });
  }

  const rows = [...allElements.values()].flatMap((element) =>
    burdenCatchUp(
      projectBurdenTargets(pools, rates, element),
      posted,
      element,
      appliedPoolIds
    ).map((row) => ({
      ...row,
      indirectRateType: type,
      burdenFiscalYear: fiscalYear
    }))
  );

  const indirectRateRunId = await upsertRateRun(db, {
    companyId,
    userId,
    accountingPeriodId,
    fiscalYear: ratePeriod.fiscalYear,
    periodNumber: ratePeriod.periodNumber
  });

  for (let i = 0; i < rows.length; i += BURDEN_ROWS_PER_CALL) {
    const result = await posting(
      "post-project-burden",
      { db, companyId, userId },
      {
        indirectRateRunId,
        accountingPeriodId,
        postingDate: ratePeriod.periodEnd,
        postApplied: settings?.postAppliedBurden ?? false,
        rows: rows.slice(i, i + BURDEN_ROWS_PER_CALL)
      }
    );
    if (result.error) {
      return refuse(result.error.message || "The burden could not be posted");
    }
  }

  await db
    .updateTable("indirectRateRun")
    .set({
      burdenComputedAt: datetime.timestamp(),
      burdenRateType: type,
      burdenRowCount: rows.length,
      error: null,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", indirectRateRunId)
    .where("companyId", "=", companyId)
    .execute();

  return {
    data: { indirectRateRunId, burdenRowCount: rows.length },
    error: null
  };
}

/**
 * The fiscal year of a date column, in SQL (`fiscalYearAndPeriodFor`). The
 * month is a literal, so the expression is identical in SELECT and GROUP BY.
 */
function fiscalYearSql(column: string, startMonth: number) {
  return startMonth === 1
    ? sql<number>`EXTRACT(YEAR FROM ${sql.ref(column)})::int`
    : sql<number>`(EXTRACT(YEAR FROM ${sql.ref(column)})
        + CASE WHEN EXTRACT(MONTH FROM ${sql.ref(column)}) >= ${sql.lit(startMonth)} THEN 1 ELSE 0 END)::int`;
}

function burdenItemDescription(
  pool: Pick<PoolDef, "name" | "baseType">,
  fiscalYear: number,
  rate: number
): string {
  const shown =
    pool.baseType === "Direct Labor Hours"
      ? `${formatQuantity(rate, "en-US")} per hour`
      : formatPercent(rate, "en-US");
  return `${pool.name} FY${fiscalYear} at ${shown}`;
}

/**
 * B5: bills burden by difference for every Cost Plus line of an Active
 * contract. Per line, pool and fiscal year, the target is the line's billable
 * base × the billing rate (Final, else Provisional, capped by the line's
 * ceiling) × (1 + fee), less every burden item the line already has. Each
 * difference becomes one Unbilled burden item dated the period end.
 */
export async function computeBurdenBilling(
  db: Kysely<KyselyDatabase>,
  client: Client,
  {
    companyId,
    userId,
    accountingPeriodId
  }: { companyId: string; userId: string; accountingPeriodId: string }
): Promise<
  | {
      data: { billableItemCount: number; warnings: string[] };
      error: null;
    }
  | { data: null; error: { message: string } }
> {
  await requireEntitlement(client, companyId, FEATURE);

  const ratePeriod = await loadRatePeriod(db, {
    companyId,
    accountingPeriodId
  });
  const pools = await loadAppliedPools(db, companyId);
  const indirectRateRunId = await upsertRateRun(db, {
    companyId,
    userId,
    accountingPeriodId,
    fiscalYear: ratePeriod.fiscalYear,
    periodNumber: ratePeriod.periodNumber
  });

  const lines = await db
    .selectFrom("customerContractLine as l")
    .innerJoin("customerContract as c", (join) =>
      join
        .onRef("c.id", "=", "l.customerContractId")
        .onRef("c.companyId", "=", "l.companyId")
    )
    .select(["l.id", "l.projectId", "l.projectElementId", "l.feePercent"])
    .where("l.companyId", "=", companyId)
    .where("l.billingMethod", "=", "Cost Plus")
    .where("c.status", "=", "Active")
    .where("l.projectId", "is not", null)
    .where("l.projectElementId", "is not", null)
    .execute();

  let adjustments: BurdenBillingAdjustment[] = [];
  let warnings: string[] = [];
  if (lines.length > 0 && pools.length > 0) {
    const lineIds = lines.map((line) => line.id);
    const poolIds = pools.map((pool) => pool.id);
    const fy = fiscalYearSql("pl.postingDate", ratePeriod.startMonth);

    const [baseRows, existingRows, ceilingRows] = await Promise.all([
      sql<{
        customerContractLineId: string;
        fiscalYear: number;
        costType: keyof typeof PROJECT_BASE_BUCKETS;
        amount: number;
        quantity: number;
      }>`
        SELECT bi."customerContractLineId", ${fy} AS "fiscalYear", pl."costType",
               SUM(pl."amount") AS "amount",
               SUM(COALESCE(pl."quantity", 0)) AS "quantity"
        FROM "projectBillableItem" bi
        INNER JOIN "projectLedger" pl
          ON pl."id" = bi."projectLedgerId" AND pl."companyId" = bi."companyId"
        WHERE bi."companyId" = ${companyId}
          AND bi."customerContractLineId" = ANY(${lineIds}::text[])
          AND bi."status" <> 'Written Off'
          AND pl."costType" <> 'Burden'
        GROUP BY bi."customerContractLineId", ${fy}, pl."costType"
      `.execute(db),
      db
        .selectFrom("projectBillableItem")
        .select([
          "customerContractLineId",
          "indirectPoolId",
          "fiscalYear",
          sql<number>`SUM("amount")`.as("amount")
        ])
        .where("companyId", "=", companyId)
        .where("customerContractLineId", "in", lineIds)
        .where("indirectPoolId", "is not", null)
        .groupBy(["customerContractLineId", "indirectPoolId", "fiscalYear"])
        .execute(),
      db
        .selectFrom("customerContractRateCeiling")
        .select(["customerContractLineId", "indirectPoolId", "ceilingRate"])
        .where("companyId", "=", companyId)
        .where("customerContractLineId", "in", lineIds)
        .execute()
    ]);

    const years = new Set<number>(baseRows.rows.map((r) => r.fiscalYear));
    for (const row of existingRows) {
      if (row.fiscalYear !== null) years.add(row.fiscalYear);
    }
    // The latest Final and Provisional rate of each pool and year, up to the
    // run's period.
    const rateRows =
      years.size === 0
        ? []
        : await db
            .selectFrom("indirectRate")
            .select([
              "indirectPoolId",
              "fiscalYear",
              "periodNumber",
              "rateType",
              "ytdRate"
            ])
            .where("companyId", "=", companyId)
            .where("indirectPoolId", "in", poolIds)
            .where("fiscalYear", "in", [...years])
            .where("rateType", "in", ["Final", "Provisional"])
            .where((eb) =>
              eb.or([
                eb("fiscalYear", "<", ratePeriod.fiscalYear),
                eb.and([
                  eb("fiscalYear", "=", ratePeriod.fiscalYear),
                  eb("periodNumber", "<=", ratePeriod.periodNumber)
                ])
              ])
            )
            .orderBy("periodNumber", "desc")
            .execute();
    const rates = new Map<
      string,
      { final: number | null; provisional: number | null }
    >();
    for (const row of rateRows) {
      const key = `${row.indirectPoolId}|${row.fiscalYear}`;
      const entry = rates.get(key) ?? { final: null, provisional: null };
      if (row.rateType === "Final" && entry.final === null) {
        entry.final = Number(row.ytdRate);
      }
      if (row.rateType === "Provisional" && entry.provisional === null) {
        entry.provisional = Number(row.ytdRate);
      }
      rates.set(key, entry);
    }

    const result = burdenBillingAdjustments({
      pools,
      rates,
      lines: lines.map((line) => {
        const baseByYear = new Map<
          number,
          Partial<Record<BaseBucket, number>>
        >();
        const absorbedOverheadByYear = new Map<number, number>();
        for (const row of baseRows.rows) {
          if (row.customerContractLineId !== line.id) continue;
          if (row.costType === "Overhead") {
            absorbedOverheadByYear.set(
              row.fiscalYear,
              (absorbedOverheadByYear.get(row.fiscalYear) ?? 0) +
                Number(row.amount)
            );
          }
          const buckets = baseByYear.get(row.fiscalYear) ?? {};
          for (const bucket of PROJECT_BASE_BUCKETS[row.costType] ?? []) {
            const value = Number(
              bucket === "LaborHours" ? row.quantity : row.amount
            );
            buckets[bucket] = (buckets[bucket] ?? 0) + value;
          }
          baseByYear.set(row.fiscalYear, buckets);
        }
        return {
          customerContractLineId: line.id,
          projectId: line.projectId!,
          projectElementId: line.projectElementId!,
          feePercent: Number(line.feePercent ?? 0),
          baseByYear,
          absorbedOverheadByYear,
          ceilings: new Map(
            ceilingRows
              .filter((row) => row.customerContractLineId === line.id)
              .map((row) => [row.indirectPoolId, Number(row.ceilingRate)])
          ),
          existing: new Map(
            existingRows
              .filter((row) => row.customerContractLineId === line.id)
              .map((row) => [
                `${row.indirectPoolId}|${row.fiscalYear}`,
                Number(row.amount)
              ])
          )
        };
      })
    });
    adjustments = result.adjustments;
    warnings = result.warnings;
  }

  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  const inserts = adjustments.map((adjustment) => ({
    companyId,
    projectId: adjustment.projectId,
    projectElementId: adjustment.projectElementId,
    projectLedgerId: null,
    customerContractLineId: adjustment.customerContractLineId,
    indirectPoolId: adjustment.indirectPoolId,
    fiscalYear: adjustment.fiscalYear,
    burdenRate: adjustment.burdenRate,
    burdenBase: adjustment.burdenBase,
    postingDate: ratePeriod.periodEnd,
    description: burdenItemDescription(
      poolById.get(adjustment.indirectPoolId)!,
      adjustment.fiscalYear,
      adjustment.burdenRate
    ),
    quantity: 1,
    unitPrice: adjustment.amount,
    amount: adjustment.amount,
    status: "Unbilled" as const,
    createdBy: userId
  }));

  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < inserts.length; i += BILLABLE_INSERT_BATCH) {
      await trx
        .insertInto("projectBillableItem")
        .values(inserts.slice(i, i + BILLABLE_INSERT_BATCH))
        .execute();
    }
    await trx
      .updateTable("indirectRateRun")
      .set({
        billingComputedAt: datetime.timestamp(),
        billableItemCount: inserts.length,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", indirectRateRunId)
      .where("companyId", "=", companyId)
      .execute();
  });

  return { data: { billableItemCount: inserts.length, warnings }, error: null };
}

type RunStepResult = { error: { message: string } | null };

/**
 * Runs the steps in order and stops at the first error, which it writes to
 * the period's `indirectRateRun.error`. An `EntitlementError` propagates.
 */
async function runSteps(
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    userId,
    accountingPeriodId
  }: { companyId: string; userId: string; accountingPeriodId: string },
  steps: (() => Promise<RunStepResult>)[]
): Promise<{
  data: { completed: true } | null;
  error: { message: string } | null;
}> {
  for (const step of steps) {
    let message: string | null = null;
    try {
      const result = await step();
      message = result.error?.message ?? null;
    } catch (error) {
      if (error instanceof EntitlementError) throw error;
      message =
        error instanceof Error && error.message
          ? error.message
          : "The indirect rate run failed";
    }
    if (message !== null) {
      const ratePeriod = await loadRatePeriod(db, {
        companyId,
        accountingPeriodId
      });
      const indirectRateRunId = await upsertRateRun(db, {
        companyId,
        userId,
        accountingPeriodId,
        fiscalYear: ratePeriod.fiscalYear,
        periodNumber: ratePeriod.periodNumber
      });
      await db
        .updateTable("indirectRateRun")
        .set({ error: message, updatedBy: userId })
        .where("id", "=", indirectRateRunId)
        .where("companyId", "=", companyId)
        .execute();
      return { data: null, error: { message } };
    }
  }
  return { data: { completed: true }, error: null };
}

/**
 * The period run, after the period locks: the Actual rates, the burden
 * catch-up, then the burden billing. The first error stops the run and is
 * written to `indirectRateRun.error`.
 */
export async function runIndirectRatePeriod(
  db: Kysely<KyselyDatabase>,
  client: Client,
  args: { companyId: string; userId: string; accountingPeriodId: string }
) {
  await requireEntitlement(client, args.companyId, FEATURE);
  return runSteps(db, args, [
    () => computeIndirectRates(db, client, args),
    () => computeProjectBurden(db, client, args),
    () => computeBurdenBilling(db, client, args)
  ]);
}

/**
 * The year-end true-up at Final rates: the burden catch-up of `fiscalYear`
 * at the Final rate of period 12, posted into the given Locked period, then
 * the burden billing.
 */
export async function runFinalTrueUp(
  db: Kysely<KyselyDatabase>,
  client: Client,
  args: {
    companyId: string;
    userId: string;
    fiscalYear: number;
    accountingPeriodId: string;
  }
) {
  await requireEntitlement(client, args.companyId, FEATURE);
  return runSteps(db, args, [
    () =>
      computeProjectBurden(db, client, {
        companyId: args.companyId,
        userId: args.userId,
        accountingPeriodId: args.accountingPeriodId,
        rateType: "Final",
        fiscalYear: args.fiscalYear
      }),
    () => computeBurdenBilling(db, client, args)
  ]);
}

// -----------------------------------------------------------------------------
// Readers (community tables, no entitlement check)
// -----------------------------------------------------------------------------

export async function getIndirectPools(client: Client, companyId: string) {
  return client
    .from("indirectPool")
    .select("*")
    .eq("companyId", companyId)
    .order("sequence");
}

export async function getIndirectPool(
  client: Client,
  id: string,
  companyId: string
) {
  const [pool, accounts] = await Promise.all([
    client
      .from("indirectPool")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId)
      .single(),
    client
      .from("indirectPoolAccount")
      .select("*, account(number, name), dimension(name)")
      .eq("indirectPoolId", id)
      .eq("companyId", companyId)
      .order("role")
  ]);
  if (pool.error) return { data: null, error: pool.error };
  if (accounts.error) return { data: null, error: accounts.error };
  return { data: { ...pool.data, accounts: accounts.data }, error: null };
}

export async function getIndirectRates(
  client: Client,
  { companyId, fiscalYear }: { companyId: string; fiscalYear: number }
) {
  return client
    .from("indirectRate")
    .select("*")
    .eq("companyId", companyId)
    .eq("fiscalYear", fiscalYear)
    .order("indirectPoolId")
    .order("periodNumber")
    .order("rateType");
}

export async function getIndirectRateRuns(client: Client, companyId: string) {
  return client
    .from("indirectRateRun")
    .select("*, accountingPeriod(startDate)")
    .eq("companyId", companyId)
    .order("fiscalYear", { ascending: false })
    .order("periodNumber", { ascending: false });
}

export async function getIndirectExpenseStatement(
  client: Client,
  {
    companyId,
    fiscalYear,
    periodNumber
  }: { companyId: string; fiscalYear: number; periodNumber: number }
) {
  // The statement has two foreign keys to `indirectPool`, so the pool names
  // come from one pool read rather than an ambiguous embed.
  const [lines, pools] = await Promise.all([
    client
      .from("indirectExpenseStatement")
      .select("*, account(number, name)")
      .eq("companyId", companyId)
      .eq("fiscalYear", fiscalYear)
      .eq("periodNumber", periodNumber)
      .order("indirectPoolId")
      .order("lineType"),
    client.from("indirectPool").select("id, name").eq("companyId", companyId)
  ]);
  if (lines.error) return { data: null, error: lines.error };
  if (pools.error) return { data: null, error: pools.error };
  const poolName = new Map(pools.data.map((p) => [p.id, p.name]));
  return {
    data: lines.data.map((line) => ({
      ...line,
      poolName: poolName.get(line.indirectPoolId) ?? null,
      sourcePoolName: line.sourcePoolId
        ? (poolName.get(line.sourcePoolId) ?? null)
        : null
    })),
    error: null
  };
}

export async function getContractRateCeilings(
  client: Client,
  {
    companyId,
    customerContractLineId
  }: { companyId: string; customerContractLineId: string }
) {
  return client
    .from("customerContractRateCeiling")
    .select("*, indirectPool(name, sequence)")
    .eq("companyId", companyId)
    .eq("customerContractLineId", customerContractLineId);
}

export async function getBurdenSettings(client: Client, companyId: string) {
  return client
    .from("companySettings")
    .select("burdenRateType, postAppliedBurden")
    .eq("id", companyId)
    .single();
}
