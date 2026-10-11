// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { equals, round } from "@carbon/utils";
import { CalendarDate, endOfMonth } from "@internationalized/date";
import {
  BASE_TYPE_BUCKETS,
  type BaseBucket,
  type BURDENED_COST_OBJECTIVES,
  type IndirectBaseType,
  type IndirectPoolType
} from "./models";

// The pure indirect rate engine (Government Contracting Phase 5b). It reads
// nothing: the loaders in `loaders.server.ts` build its input, and the runs in
// `service.server.ts` write its output.
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (B2–B4, B7)

export type PoolDef = {
  id: string;
  name: string;
  poolType: IndirectPoolType;
  sequence: number;
  baseType: IndirectBaseType;
  appliesToProjects: boolean;
  offsetAbsorbedOverhead: boolean;
};

export type PoolMapping = {
  id: string;
  indirectPoolId: string;
  accountId: string;
  dimensionId: string | null;
  dimensionValueId: string | null;
  role: "Cost" | "Base";
};

// YTD, debit-positive. dims holds the line's value per mapped dimension id.
export type GlCell = {
  accountId: string;
  dims: Record<string, string>;
  amount: number;
  unallowableAmount: number;
};

export type BurdenedCostObjective = (typeof BURDENED_COST_OBJECTIVES)[number];

// YTD project ledger cost by objective and bucket. A LaborHours cell carries hours in amount.
export type ProjectCell = {
  costObjective: BurdenedCostObjective;
  bucket: BaseBucket;
  amount: number;
  unallowableAmount: number;
};

export type StatementLine = {
  lineType: "Account" | "Carried Burden" | "Absorbed Overhead";
  accountId: string | null;
  dimensionValueId: string | null;
  sourcePoolId: string | null;
  amount: number;
  unallowableAmount: number;
};

export type PoolRateResult = {
  indirectPoolId: string;
  poolCost: number;
  unallowableCost: number;
  baseAmount: number;
  ytdRate: number;
  lines: StatementLine[];
};

const isDirectObjective = (objective: BurdenedCostObjective) =>
  objective === "Direct" || objective === "Commercial";

const isIndependentResearch = (objective: BurdenedCostObjective) =>
  objective === "IR&D" || objective === "B&P";

/**
 * B4: the most specific mapping of a GL cell for a role. A mapping whose
 * dimension value the cell carries wins over the account-only mapping.
 */
export function matchMapping(
  cell: GlCell,
  mappings: PoolMapping[],
  role: PoolMapping["role"]
): PoolMapping | null {
  const candidates = mappings.filter(
    (m) => m.accountId === cell.accountId && m.role === role
  );
  const specific = candidates.find(
    (m) =>
      m.dimensionId !== null &&
      m.dimensionValueId !== null &&
      cell.dims[m.dimensionId] === m.dimensionValueId
  );
  if (specific) return specific;
  return candidates.find((m) => m.dimensionId === null) ?? null;
}

/**
 * B2: a project cell is in a pool's base when its bucket is one the base type
 * sums, and its objective is Direct or Commercial — or IR&D or B&P for any
 * pool except G&A (their cost belongs in the G&A pool, not its base).
 */
export function projectCellInBase(pool: PoolDef, cell: ProjectCell): boolean {
  if (!BASE_TYPE_BUCKETS[pool.baseType].includes(cell.bucket)) return false;
  if (isDirectObjective(cell.costObjective)) return true;
  return isIndependentResearch(cell.costObjective) && pool.poolType !== "G&A";
}

/** B3: a Total Cost Input base takes every earlier pool's burden; Value Added all but Material Handling. */
export function carriesBurdenIntoBase(
  pool: Pick<PoolDef, "baseType">,
  earlier: Pick<PoolDef, "poolType">
): boolean {
  if (pool.baseType === "Total Cost Input") return true;
  if (pool.baseType === "Value Added") {
    return earlier.poolType !== "Material Handling";
  }
  return false;
}

export function sortPools<T extends Pick<PoolDef, "sequence">>(
  pools: T[]
): T[] {
  return [...pools].sort((a, b) => a.sequence - b.sequence);
}

/**
 * The YTD Actual rate of every pool, in cascade order (B2, B3, B7).
 * `absorbedOverhead` is the YTD debit-positive total of the overhead
 * absorption account (negative while it holds credits).
 */
export function computePoolRates({
  pools,
  mappings,
  glCells,
  projectCells,
  absorbedOverhead,
  absorbedOverheadAccountId = null
}: {
  pools: PoolDef[];
  mappings: PoolMapping[];
  glCells: GlCell[];
  projectCells: ProjectCell[];
  absorbedOverhead: number;
  absorbedOverheadAccountId?: string | null;
}): PoolRateResult[] {
  const ordered = sortPools(pools);

  // The pool each GL cell is Cost of: one at most (B4, a unique index).
  const costPoolOf = glCells.map(
    (cell) => matchMapping(cell, mappings, "Cost")?.indirectPoolId ?? null
  );
  const costMappingOf = glCells.map((cell) =>
    matchMapping(cell, mappings, "Cost")
  );
  // A cell may be Base of several pools, so match within each pool.
  const inBaseOf = (poolId: string, cell: GlCell) =>
    matchMapping(
      cell,
      mappings.filter((m) => m.indirectPoolId === poolId),
      "Base"
    ) !== null;

  const results: PoolRateResult[] = [];
  const rateOf = new Map<string, number>();

  for (const pool of ordered) {
    let poolCost = 0;
    let unallowableCost = 0;
    let baseAmount = 0;
    const accountLines = new Map<string, StatementLine>();
    const carriedLines: StatementLine[] = [];

    // 1. Cost: the allowable amount of every GL cell mapped to the pool as Cost.
    glCells.forEach((cell, index) => {
      if (costPoolOf[index] !== pool.id) return;
      poolCost += cell.amount - cell.unallowableAmount;
      unallowableCost += cell.unallowableAmount;
      const dimensionValueId = costMappingOf[index]?.dimensionValueId ?? null;
      const key = `${cell.accountId}|${dimensionValueId ?? ""}`;
      const line = accountLines.get(key) ?? {
        lineType: "Account" as const,
        accountId: cell.accountId,
        dimensionValueId,
        sourcePoolId: null,
        amount: 0,
        unallowableAmount: 0
      };
      line.amount += cell.amount;
      line.unallowableAmount += cell.unallowableAmount;
      accountLines.set(key, line);
    });

    // 2. Base: the full amount, unallowable included (CAS 405-40(e)).
    for (const cell of glCells) {
      if (inBaseOf(pool.id, cell)) baseAmount += cell.amount;
    }
    for (const cell of projectCells) {
      if (projectCellInBase(pool, cell)) baseAmount += cell.amount;
    }

    // 3. Carry-in from every earlier pool (B3).
    for (const earlier of results) {
      const source = ordered.find((p) => p.id === earlier.indirectPoolId)!;
      const rate = rateOf.get(source.id) ?? 0;
      let carried = 0;
      let carriedUnallowable = 0;

      // 3.1 The earlier rate on a cell that is its Base and this pool's Cost.
      glCells.forEach((cell, index) => {
        if (costPoolOf[index] !== pool.id) return;
        if (!inBaseOf(source.id, cell)) return;
        carried += rate * (cell.amount - cell.unallowableAmount);
        carriedUnallowable += rate * cell.unallowableAmount;
      });

      // 3.2 The earlier burden on IR&D and B&P cost goes into G&A cost.
      if (pool.poolType === "G&A" && source.poolType !== "G&A") {
        for (const cell of projectCells) {
          if (!isIndependentResearch(cell.costObjective)) continue;
          if (!projectCellInBase(source, cell)) continue;
          carried += rate * (cell.amount - cell.unallowableAmount);
          carriedUnallowable += rate * cell.unallowableAmount;
        }
      }

      // 3.3 TCI and Value Added bases take the earlier burden on direct cost.
      if (source.appliesToProjects && carriesBurdenIntoBase(pool, source)) {
        for (const cell of projectCells) {
          if (!isDirectObjective(cell.costObjective)) continue;
          if (!projectCellInBase(source, cell)) continue;
          baseAmount += rate * cell.amount;
        }
      }

      poolCost += carried;
      unallowableCost += carriedUnallowable;
      if (!equals(carried, 0) || !equals(carriedUnallowable, 0)) {
        carriedLines.push({
          lineType: "Carried Burden",
          accountId: null,
          dimensionValueId: null,
          sourcePoolId: source.id,
          amount: round(carried + carriedUnallowable),
          unallowableAmount: round(carriedUnallowable)
        });
      }
    }

    // 4. Rate.
    const ytdRate = equals(baseAmount, 0) ? 0 : round(poolCost / baseAmount);
    rateOf.set(pool.id, ytdRate);

    const lines: StatementLine[] = [
      ...[...accountLines.values()].map((line) => ({
        ...line,
        amount: round(line.amount),
        unallowableAmount: round(line.unallowableAmount)
      })),
      ...carriedLines
    ];

    // 5. Absorbed overhead (B7): shown as a line, never in the numerator.
    if (pool.offsetAbsorbedOverhead) {
      lines.push({
        lineType: "Absorbed Overhead",
        accountId: absorbedOverheadAccountId,
        dimensionValueId: null,
        sourcePoolId: null,
        amount: round(absorbedOverhead),
        unallowableAmount: 0
      });
    }

    results.push({
      indirectPoolId: pool.id,
      poolCost: round(poolCost),
      unallowableCost: round(unallowableCost),
      baseAmount: round(baseAmount),
      ytdRate,
      lines
    });
  }

  return results;
}

/**
 * The dates of a fiscal period. Fiscal year N ends in calendar year N, and
 * period 1 starts on the fiscal start month — the rule of
 * `fiscalYearAndPeriodFor` (`packages/utils/src/accounting.ts`).
 */
export function fiscalYearRange(
  fiscalYear: number,
  periodNumber: number,
  startMonth: number
): { start: string; periodStart: string; periodEnd: string } {
  const start = new CalendarDate(
    startMonth === 1 ? fiscalYear : fiscalYear - 1,
    startMonth,
    1
  );
  const periodStart = start.add({ months: periodNumber - 1 });
  const periodEnd = endOfMonth(periodStart);
  return {
    start: start.toString(),
    periodStart: periodStart.toString(),
    periodEnd: periodEnd.toString()
  };
}

/** The period's own rate: its cost change over its base change. */
export function periodRateFrom(
  current: { poolCost: number; baseAmount: number },
  previous: { poolCost: number; baseAmount: number } | null
): number | null {
  const baseChange = current.baseAmount - (previous?.baseAmount ?? 0);
  if (equals(baseChange, 0)) return null;
  return round((current.poolCost - (previous?.poolCost ?? 0)) / baseChange);
}
