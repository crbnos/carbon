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
  return objectiveInBase(pool, cell.costObjective);
}

function objectiveInBase(
  pool: Pick<PoolDef, "poolType">,
  objective: BurdenedCostObjective
): boolean {
  if (isDirectObjective(objective)) return true;
  return isIndependentResearch(objective) && pool.poolType !== "G&A";
}

/** The elements' cost summed by objective and bucket. */
function projectCellsOf(elements: ElementCells[]): ProjectCell[] {
  const cells = new Map<string, ProjectCell>();
  for (const element of elements) {
    for (const [bucket, value] of Object.entries(element.buckets)) {
      if (!value) continue;
      const key = `${element.costObjective}|${bucket}`;
      const cell = cells.get(key) ?? {
        costObjective: element.costObjective,
        bucket: bucket as BaseBucket,
        amount: 0,
        unallowableAmount: 0
      };
      cell.amount += value.amount;
      cell.unallowableAmount += value.unallowableAmount;
      cells.set(key, cell);
    }
  }
  return [...cells.values()];
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
 * `elements` is the YTD project cost of every burdened element, as the burden
 * run reads it. `absorbedOverhead` is the YTD debit-positive total of the
 * overhead absorption account (negative while it holds credits).
 *
 * The burden an earlier pool carries into a later one (3.2, 3.3) is the burden
 * it applies to the projects: `projectBurdenTargets` of each element at the
 * rates computed so far. So a base takes an earlier pool's own carried-in
 * burden, net of the absorbed overhead of an offset pool (B7), and the rate
 * run's base is the base the burden run applies the rate to.
 */
export function computePoolRates({
  pools,
  mappings,
  glCells,
  elements,
  absorbedOverhead,
  absorbedOverheadAccountId = null
}: {
  pools: PoolDef[];
  mappings: PoolMapping[];
  glCells: GlCell[];
  elements: ElementCells[];
  absorbedOverhead: number;
  absorbedOverheadAccountId?: string | null;
}): PoolRateResult[] {
  const ordered = sortPools(pools);
  const projectPools = ordered.filter((p) => p.appliesToProjects);
  const projectCells = projectCellsOf(elements);

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

    // 3. Carry-in from every earlier pool (B3). `rateOf` holds the earlier
    // pools only, so the targets are their burden on each element.
    const applied = elements.map((element) => ({
      element,
      targets: projectBurdenTargets(projectPools, rateOf, element)
    }));
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

      // 3.2 The earlier burden on IR&D and B&P cost goes into G&A cost: the
      // burden applied to it, or the rate on its base for a pool that
      // applies to no project.
      if (pool.poolType === "G&A" && source.poolType !== "G&A") {
        if (source.appliesToProjects) {
          for (const { element, targets } of applied) {
            if (!isIndependentResearch(element.costObjective)) continue;
            const target = targets.get(source.id);
            if (!target) continue;
            carried += target.allowable;
            carriedUnallowable += target.unallowable;
          }
        } else {
          for (const cell of projectCells) {
            if (!isIndependentResearch(cell.costObjective)) continue;
            if (!projectCellInBase(source, cell)) continue;
            carried += rate * (cell.amount - cell.unallowableAmount);
            carriedUnallowable += rate * cell.unallowableAmount;
          }
        }
      }

      // 3.3 TCI and Value Added bases take the earlier burden applied to the
      // project cost in their base.
      if (source.appliesToProjects && carriesBurdenIntoBase(pool, source)) {
        for (const { element, targets } of applied) {
          if (!objectiveInBase(pool, element.costObjective)) continue;
          const target = targets.get(source.id);
          if (!target) continue;
          baseAmount += target.allowable + target.unallowable;
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

// ---------------------------------------------------------------------------
// Burden and burden billing (B5, B7, B8)
// ---------------------------------------------------------------------------

// YTD cost of one element (null = project level), by bucket. Hours in the LaborHours bucket.
export type ElementCells = {
  projectId: string;
  projectElementId: string | null;
  costObjective: BurdenedCostObjective;
  buckets: Partial<
    Record<BaseBucket, { amount: number; unallowableAmount: number }>
  >;
  absorbedOverhead: number; // YTD Overhead ledger rows of the element (B7)
};

export type PostedBurden = {
  projectId: string;
  projectElementId: string | null;
  indirectPoolId: string;
  unallowable: boolean;
  amount: number; // Σ Burden rows of the fiscal year in the run's window
};

export type BurdenRow = {
  projectId: string;
  projectElementId: string | null;
  indirectPoolId: string;
  unallowable: boolean;
  amount: number; // the delta to post
};

export type BurdenTarget = { allowable: number; unallowable: number };

/**
 * The YTD burden one element should carry per pool, split by the unallowable
 * flag of its base (B8). Only pools that apply to projects and have a rate count.
 */
export function projectBurdenTargets(
  pools: PoolDef[],
  rates: Map<string, number>,
  element: ElementCells
): Map<string, BurdenTarget> {
  const targets = new Map<string, BurdenTarget>();
  const applied: { pool: PoolDef; target: BurdenTarget }[] = [];

  for (const pool of sortPools(pools)) {
    if (!pool.appliesToProjects) continue;
    const rate = rates.get(pool.id);
    if (rate === undefined) continue;
    // IR&D and B&P cost belongs in the G&A pool, so G&A burdens none of it (B2).
    if (
      pool.poolType === "G&A" &&
      isIndependentResearch(element.costObjective)
    ) {
      continue;
    }

    let allowableBase = 0;
    let unallowableBase = 0;
    for (const bucket of BASE_TYPE_BUCKETS[pool.baseType]) {
      const cell = element.buckets[bucket];
      if (!cell) continue;
      allowableBase += cell.amount - cell.unallowableAmount;
      unallowableBase += cell.unallowableAmount;
    }
    for (const earlier of applied) {
      if (!carriesBurdenIntoBase(pool, earlier.pool)) continue;
      allowableBase += earlier.target.allowable;
      unallowableBase += earlier.target.unallowable;
    }

    let allowable = rate * allowableBase;
    const unallowable = rate * unallowableBase;
    if (pool.offsetAbsorbedOverhead) {
      allowable = Math.max(0, allowable - element.absorbedOverhead);
    }

    const target = { allowable, unallowable };
    targets.set(pool.id, target);
    applied.push({ pool, target });
  }

  return targets;
}

/**
 * The YTD catch-up: each pool × unallowable flag posts its target less what
 * the fiscal year already posted. An applied pool with posted burden and no
 * target any more posts it back to zero.
 *
 * `appliedPoolIds` are the pools the run applies (active, applying to
 * projects). The posted burden of any other pool is left as it is: a pool
 * deactivated mid-year keeps the burden it posted, as its billing keeps the
 * burden it billed (`burdenBillingAdjustments` bills applied pools only).
 */
export function burdenCatchUp(
  targets: Map<string, BurdenTarget>,
  posted: PostedBurden[],
  element: Pick<ElementCells, "projectId" | "projectElementId">,
  appliedPoolIds: ReadonlySet<string>
): BurdenRow[] {
  const postedByKey = new Map<string, number>();
  for (const row of posted) {
    if (row.projectId !== element.projectId) continue;
    if (row.projectElementId !== element.projectElementId) continue;
    if (!appliedPoolIds.has(row.indirectPoolId)) continue;
    const key = `${row.indirectPoolId}|${row.unallowable}`;
    postedByKey.set(key, (postedByKey.get(key) ?? 0) + row.amount);
  }

  const poolIds = new Set<string>(targets.keys());
  for (const key of postedByKey.keys()) poolIds.add(key.split("|")[0]!);

  const rows: BurdenRow[] = [];
  for (const indirectPoolId of poolIds) {
    const target = targets.get(indirectPoolId);
    for (const unallowable of [false, true]) {
      const goal = unallowable
        ? (target?.unallowable ?? 0)
        : (target?.allowable ?? 0);
      const already = postedByKey.get(`${indirectPoolId}|${unallowable}`) ?? 0;
      const delta = round(goal - already);
      if (equals(delta, 0)) continue;
      rows.push({
        projectId: element.projectId,
        projectElementId: element.projectElementId,
        indirectPoolId,
        unallowable,
        amount: delta
      });
    }
  }
  return rows;
}

/** The rate burden bills at: Final when set, else Provisional, capped by the line's ceiling. */
export function billingRateFor({
  final,
  provisional,
  ceiling
}: {
  final: number | null;
  provisional: number | null;
  ceiling: number | null;
}): number | null {
  const rate = final ?? provisional;
  if (rate === null || rate === undefined) return null;
  if (ceiling === null || ceiling === undefined) return rate;
  return Math.min(rate, ceiling);
}

export type BillingInput = {
  pools: PoolDef[];
  lines: {
    customerContractLineId: string;
    projectId: string;
    projectElementId: string;
    feePercent: number;
    // Σ ledger cost of the line's billable items that are not Written Off, by fiscal year and bucket
    baseByYear: Map<number, Partial<Record<BaseBucket, number>>>;
    // The Overhead ledger rows among them, by fiscal year (B7): already billed at cost
    absorbedOverheadByYear: Map<number, number>;
    ceilings: Map<string, number>; // poolId → ceiling rate
    existing: Map<string, number>; // `${poolId}|${fiscalYear}` → Σ amount of the line's burden items
  }[];
  rates: Map<string, { final: number | null; provisional: number | null }>; // `${poolId}|${fiscalYear}`
};

export type BurdenBillingAdjustment = {
  customerContractLineId: string;
  projectId: string;
  projectElementId: string;
  indirectPoolId: string;
  fiscalYear: number;
  burdenRate: number;
  burdenBase: number;
  amount: number;
};

/**
 * B5: burden billing by difference, per contract line × pool × fiscal year.
 * Target = billable base × billing rate × (1 + fee %), less every burden item
 * the line already has. One rule covers first billing, re-burden and the
 * true-up at Final rates, and never touches a posted invoice.
 */
export function burdenBillingAdjustments(input: BillingInput): {
  adjustments: BurdenBillingAdjustment[];
  warnings: string[];
} {
  const ordered = sortPools(input.pools).filter((p) => p.appliesToProjects);
  const adjustments: BurdenBillingAdjustment[] = [];
  const warnings = new Set<string>();

  for (const line of input.lines) {
    const years = new Set<number>(line.baseByYear.keys());
    for (const key of line.existing.keys()) {
      years.add(Number(key.split("|")[1]));
    }

    for (const fiscalYear of [...years].sort((a, b) => a - b)) {
      const buckets = line.baseByYear.get(fiscalYear) ?? {};
      const applied: { pool: PoolDef; burden: number }[] = [];

      for (const pool of ordered) {
        const rates = input.rates.get(`${pool.id}|${fiscalYear}`);
        const rate = billingRateFor({
          final: rates?.final ?? null,
          provisional: rates?.provisional ?? null,
          ceiling: line.ceilings.get(pool.id) ?? null
        });
        if (rate === null) {
          warnings.add(
            `No Provisional rate for ${pool.name} in FY${fiscalYear}`
          );
          continue;
        }

        let base = 0;
        for (const bucket of BASE_TYPE_BUCKETS[pool.baseType]) {
          base += buckets[bucket] ?? 0;
        }
        for (const earlier of applied) {
          if (carriesBurdenIntoBase(pool, earlier.pool)) base += earlier.burden;
        }

        // B7, as projectBurdenTargets: the line's Overhead rows are billed at
        // cost, so an offset pool bills only the burden above them.
        const burden = pool.offsetAbsorbedOverhead
          ? Math.max(
              0,
              rate * base - (line.absorbedOverheadByYear.get(fiscalYear) ?? 0)
            )
          : rate * base;
        applied.push({ pool, burden });

        const existing = line.existing.get(`${pool.id}|${fiscalYear}`) ?? 0;
        const amount = round(burden * (1 + line.feePercent) - existing);
        if (equals(amount, 0)) continue;
        adjustments.push({
          customerContractLineId: line.customerContractLineId,
          projectId: line.projectId,
          projectElementId: line.projectElementId,
          indirectPoolId: pool.id,
          fiscalYear,
          burdenRate: rate,
          burdenBase: round(base),
          amount
        });
      }
    }
  }

  return { adjustments, warnings: [...warnings] };
}
