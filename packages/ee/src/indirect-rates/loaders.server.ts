// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Readers that build the rate engine's input (Government Contracting 5b).
// Each reader is one SQL statement over the privileged Kysely client, so every
// query filters on `companyId` itself.
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (Task 8, B2, B14)

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { fiscalYearAndPeriodFor, MONTH_NUMBER } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import {
  type BurdenedCostObjective,
  type ElementCells,
  fiscalYearRange,
  type GlCell,
  type PoolMapping,
  type PostedBurden,
  type ProjectCell
} from "./compute";
import {
  type BaseBucket,
  BURDENED_COST_OBJECTIVES,
  PROJECT_BASE_BUCKETS
} from "./models";

type Db = Kysely<KyselyDatabase>;

// GL readers count Posted and Reversed journals (the accounting cutover's
// rule): a Provisional journal counts nowhere, and a Reversed journal nets
// against its Posted reversal.
const COUNTED_JOURNAL_STATUSES = ["Posted", "Reversed"] as const;

export type RatePeriod = {
  period: {
    id: string;
    startDate: string;
    endDate: string;
    status: string;
    closeStatus: string | null;
  };
  fiscalYear: number;
  periodNumber: number;
  /** The fiscal year's first month, 1–12. */
  startMonth: number;
  fyStart: string;
  periodStart: string;
  periodEnd: string;
};

/** The period, its fiscal numbers (B14 when they are null) and its YTD dates. */
export async function loadRatePeriod(
  db: Db,
  {
    companyId,
    accountingPeriodId
  }: { companyId: string; accountingPeriodId: string }
): Promise<RatePeriod> {
  const [period, settings] = await Promise.all([
    db
      .selectFrom("accountingPeriod")
      .select([
        "id",
        sql<string>`"startDate"::text`.as("startDate"),
        sql<string>`"endDate"::text`.as("endDate"),
        "status",
        "closeStatus",
        "fiscalYear",
        "periodNumber"
      ])
      .where("id", "=", accountingPeriodId)
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    db
      .selectFrom("fiscalYearSettings")
      .select("startMonth")
      .where("companyId", "=", companyId)
      .executeTakeFirst()
  ]);
  if (!period) throw new Error("The accounting period could not be found");

  const startMonth = MONTH_NUMBER[settings?.startMonth ?? "January"] ?? 1;
  let { fiscalYear, periodNumber } = period;
  if (fiscalYear === null || periodNumber === null) {
    const start = parseDate(period.startDate);
    ({ fiscalYear, periodNumber } = fiscalYearAndPeriodFor(
      start.year,
      start.month,
      startMonth
    ));
  }

  const range = fiscalYearRange(fiscalYear, periodNumber, startMonth);
  return {
    period: {
      id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status,
      closeStatus: period.closeStatus
    },
    fiscalYear,
    periodNumber,
    startMonth,
    fyStart: range.start,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd
  };
}

/**
 * YTD GL cells of the mapped accounts, debit-positive, grouped by account and
 * the line's values of the mapped dimensions. A line is unallowable when its
 * account is not Allowable, or when an unallowable project ledger row points
 * at it.
 */
export async function loadGlCells(
  db: Db,
  {
    companyId,
    mappings,
    from,
    to
  }: { companyId: string; mappings: PoolMapping[]; from: string; to: string }
): Promise<GlCell[]> {
  const accountIds = [...new Set(mappings.map((m) => m.accountId))];
  if (accountIds.length === 0) return [];
  const dimensionIds = [
    ...new Set(
      mappings.map((m) => m.dimensionId).filter((id): id is string => !!id)
    )
  ];

  const result = await sql<{
    accountId: string;
    dims: Record<string, string>;
    amount: number;
    unallowableAmount: number;
  }>`
    WITH "lines" AS (
      SELECT
        jl."accountId",
        CASE WHEN a."class" IN ('Liability', 'Equity', 'Revenue')
          THEN -jl."amount" ELSE jl."amount" END AS "amount",
        (
          a."allowability" <> 'Allowable'
          OR EXISTS (
            SELECT 1 FROM "projectLedger" pl
            WHERE pl."journalLineId" = jl."id"
              AND pl."companyId" = jl."companyId"
              AND pl."unallowable"
          )
        ) AS "unallowable",
        COALESCE((
          SELECT jsonb_object_agg(d."dimensionId", d."valueId")
          FROM "journalLineDimension" d
          WHERE d."journalLineId" = jl."id"
            AND d."companyId" = jl."companyId"
            AND d."dimensionId" = ANY(${dimensionIds}::text[])
        ), '{}'::jsonb) AS "dims"
      FROM "journal" j
      INNER JOIN "journalLine" jl
        ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
      INNER JOIN "account" a ON a."id" = jl."accountId"
      WHERE j."companyId" = ${companyId}
        AND j."status" = ANY(${[...COUNTED_JOURNAL_STATUSES]}::"journalEntryStatus"[])
        AND j."postingDate" >= ${from}::date
        AND j."postingDate" <= ${to}::date
        AND jl."accountId" = ANY(${accountIds}::text[])
    )
    SELECT
      "accountId",
      "dims",
      SUM("amount") AS "amount",
      SUM(CASE WHEN "unallowable" THEN "amount" ELSE 0 END) AS "unallowableAmount"
    FROM "lines"
    GROUP BY "accountId", "dims"
  `.execute(db);

  return result.rows.map((row) => ({
    accountId: row.accountId,
    dims: row.dims ?? {},
    amount: Number(row.amount),
    unallowableAmount: Number(row.unallowableAmount)
  }));
}

/**
 * YTD project ledger cost of the burdened cost objectives, by objective and
 * base bucket (B2). Burden rows feed no base. The LaborHours bucket carries
 * hours, not dollars.
 */
export async function loadProjectCells(
  db: Db,
  { companyId, from, to }: { companyId: string; from: string; to: string }
): Promise<ProjectCell[]> {
  const result = await sql<{
    costObjective: BurdenedCostObjective;
    costType: keyof typeof PROJECT_BASE_BUCKETS;
    amount: number;
    quantity: number;
    unallowableAmount: number;
    unallowableQuantity: number;
  }>`
    SELECT
      p."costObjective",
      pl."costType",
      SUM(pl."amount") AS "amount",
      SUM(COALESCE(pl."quantity", 0)) AS "quantity",
      SUM(CASE WHEN pl."unallowable" THEN pl."amount" ELSE 0 END) AS "unallowableAmount",
      SUM(CASE WHEN pl."unallowable" THEN COALESCE(pl."quantity", 0) ELSE 0 END) AS "unallowableQuantity"
    FROM "projectLedger" pl
    INNER JOIN "project" p
      ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
    WHERE pl."companyId" = ${companyId}
      AND pl."postingDate" >= ${from}::date
      AND pl."postingDate" <= ${to}::date
      AND pl."costType" <> 'Burden'
      AND p."costObjective"::text = ANY(${[...BURDENED_COST_OBJECTIVES]}::text[])
    GROUP BY p."costObjective", pl."costType"
  `.execute(db);

  return toProjectCells(result.rows);
}

/** Maps ledger groups to base buckets with `PROJECT_BASE_BUCKETS`. */
export function toProjectCells(
  groups: {
    costObjective: BurdenedCostObjective;
    costType: keyof typeof PROJECT_BASE_BUCKETS;
    amount: number;
    quantity: number;
    unallowableAmount: number;
    unallowableQuantity: number;
  }[]
): ProjectCell[] {
  const cells = new Map<string, ProjectCell>();
  for (const group of groups) {
    for (const bucket of PROJECT_BASE_BUCKETS[group.costType] ?? []) {
      const hours = bucket === "LaborHours";
      const key = `${group.costObjective}|${bucket}`;
      const cell = cells.get(key) ?? {
        costObjective: group.costObjective,
        bucket: bucket as BaseBucket,
        amount: 0,
        unallowableAmount: 0
      };
      cell.amount += Number(hours ? group.quantity : group.amount);
      cell.unallowableAmount += Number(
        hours ? group.unallowableQuantity : group.unallowableAmount
      );
      cells.set(key, cell);
    }
  }
  return [...cells.values()];
}

/** The debit-positive YTD total of `accountDefault.overheadAbsorptionAccount` (B7). */
export async function loadAbsorbedOverhead(
  db: Db,
  { companyId, from, to }: { companyId: string; from: string; to: string }
): Promise<{ accountId: string | null; amount: number }> {
  const result = await sql<{ accountId: string | null; amount: number | null }>`
    SELECT
      ad."overheadAbsorptionAccount" AS "accountId",
      (
        SELECT SUM(
          CASE WHEN a."class" IN ('Liability', 'Equity', 'Revenue')
            THEN -jl."amount" ELSE jl."amount" END
        )
        FROM "journal" j
        INNER JOIN "journalLine" jl
          ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
        INNER JOIN "account" a ON a."id" = jl."accountId"
        WHERE j."companyId" = ${companyId}
          AND j."status" = ANY(${[...COUNTED_JOURNAL_STATUSES]}::"journalEntryStatus"[])
          AND j."postingDate" >= ${from}::date
          AND j."postingDate" <= ${to}::date
          AND jl."accountId" = ad."overheadAbsorptionAccount"
      ) AS "amount"
    FROM "accountDefault" ad
    WHERE ad."companyId" = ${companyId}
  `.execute(db);

  const row = result.rows[0];
  return {
    accountId: row?.accountId ?? null,
    amount: Number(row?.amount ?? 0)
  };
}

type ElementGroup = {
  projectId: string;
  projectElementId: string | null;
  costObjective: BurdenedCostObjective;
  costType: keyof typeof PROJECT_BASE_BUCKETS;
  amount: number;
  quantity: number;
  unallowableAmount: number;
  unallowableQuantity: number;
};

/**
 * YTD project ledger cost of each element (null = project level) of the
 * burdened cost objectives, by base bucket (B8). Burden rows feed no base.
 * `absorbedOverhead` is the element's Overhead rows (B7).
 */
export async function loadElementCells(
  db: Db,
  { companyId, from, to }: { companyId: string; from: string; to: string }
): Promise<ElementCells[]> {
  const result = await sql<ElementGroup>`
    SELECT
      pl."projectId",
      pl."projectElementId",
      p."costObjective",
      pl."costType",
      SUM(pl."amount") AS "amount",
      SUM(COALESCE(pl."quantity", 0)) AS "quantity",
      SUM(CASE WHEN pl."unallowable" THEN pl."amount" ELSE 0 END) AS "unallowableAmount",
      SUM(CASE WHEN pl."unallowable" THEN COALESCE(pl."quantity", 0) ELSE 0 END) AS "unallowableQuantity"
    FROM "projectLedger" pl
    INNER JOIN "project" p
      ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
    WHERE pl."companyId" = ${companyId}
      AND pl."postingDate" >= ${from}::date
      AND pl."postingDate" <= ${to}::date
      AND pl."costType" <> 'Burden'
      AND p."costObjective"::text = ANY(${[...BURDENED_COST_OBJECTIVES]}::text[])
    GROUP BY pl."projectId", pl."projectElementId", p."costObjective", pl."costType"
  `.execute(db);

  return toElementCells(result.rows);
}

/** Groups ledger sums into one `ElementCells` per project and element. */
export function toElementCells(groups: ElementGroup[]): ElementCells[] {
  const elements = new Map<string, ElementCells>();
  for (const group of groups) {
    const key = `${group.projectId}|${group.projectElementId ?? ""}`;
    const element = elements.get(key) ?? {
      projectId: group.projectId,
      projectElementId: group.projectElementId,
      costObjective: group.costObjective,
      buckets: {},
      absorbedOverhead: 0
    };
    for (const bucket of PROJECT_BASE_BUCKETS[group.costType] ?? []) {
      const hours = bucket === "LaborHours";
      const cell = element.buckets[bucket] ?? {
        amount: 0,
        unallowableAmount: 0
      };
      cell.amount += Number(hours ? group.quantity : group.amount);
      cell.unallowableAmount += Number(
        hours ? group.unallowableQuantity : group.unallowableAmount
      );
      element.buckets[bucket] = cell;
    }
    if (group.costType === "Overhead") {
      element.absorbedOverhead += Number(group.amount);
    }
    elements.set(key, element);
  }
  return [...elements.values()];
}

/**
 * Σ Burden rows of the fiscal year by project, element, pool and flag (B8),
 * over the same window as the target they are netted against.
 *
 * A period run's target is the YTD burden through its period, so it counts
 * only the year's rows dated on or before the period end, and never the Final
 * true-up's: re-running or relocking an earlier period then posts that
 * period's correction alone, and a Provisional re-run of period 12 leaves the
 * true-up standing. The true-up (`through` null) targets the whole year at
 * Final rates, so it counts every row of the year, wherever it was posted.
 */
export async function loadPostedBurden(
  db: Db,
  {
    companyId,
    fiscalYear,
    through
  }: { companyId: string; fiscalYear: number; through: string | null }
): Promise<PostedBurden[]> {
  const window =
    through === null
      ? sql``
      : sql`AND pl."postingDate" <= ${through}::date
      AND pl."indirectRateType" <> 'Final'`;
  const result = await sql<PostedBurden>`
    SELECT
      pl."projectId",
      pl."projectElementId",
      pl."indirectPoolId",
      pl."unallowable",
      SUM(pl."amount") AS "amount"
    FROM "projectLedger" pl
    WHERE pl."companyId" = ${companyId}
      AND pl."costType" = 'Burden'
      AND pl."burdenFiscalYear" = ${fiscalYear}
      ${window}
    GROUP BY pl."projectId", pl."projectElementId", pl."indirectPoolId", pl."unallowable"
  `.execute(db);

  return result.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}
