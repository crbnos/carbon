// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The pure builders of the Incurred Cost Electronic (ICE) schedules
// (Government Contracting 5b). They read nothing: `ice.server.ts` loads their
// input with the rate run's readers, and the CSV route encodes their output.
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (Task 14, B15)

import type { Database } from "@carbon/database";
import { round } from "@carbon/utils";
import {
  type BurdenedCostObjective,
  type ElementCells,
  type GlCell,
  matchMapping,
  type PoolDef,
  type PoolMapping,
  type ProjectCell,
  projectBurdenTargets,
  projectCellInBase,
  sortPools
} from "./compute";
import type { BaseBucket, ICE_SCHEDULES } from "./models";

export type IceSchedule = (typeof ICE_SCHEDULES)[number];

export type IceTable = { fields: string[]; rows: (string | number)[][] };

type ElementOfCost = Database["public"]["Enums"]["elementOfCost"];

const money = (value: number) => round(value);

// -----------------------------------------------------------------------------
// Schedule A: the claimed rates
// -----------------------------------------------------------------------------

export type ActualRateRow = {
  indirectPoolId: string;
  poolCost: number;
  baseAmount: number;
  ytdRate: number;
};

/** A: one row per pool with an Actual rate, in sequence order. */
export function buildScheduleA(
  pools: PoolDef[],
  actual: ActualRateRow[]
): IceTable {
  const byPool = new Map(actual.map((row) => [row.indirectPoolId, row]));
  return {
    fields: [
      "Pool",
      "Pool type",
      "Base type",
      "Base",
      "Allowable pool cost",
      "Claimed rate"
    ],
    rows: sortPools(pools).flatMap((pool) => {
      const row = byPool.get(pool.id);
      if (!row) return [];
      return [
        [
          pool.name,
          pool.poolType,
          pool.baseType,
          money(row.baseAmount),
          money(row.poolCost),
          row.ytdRate
        ]
      ];
    })
  };
}

// -----------------------------------------------------------------------------
// Schedules B and C: the pool expenses
// -----------------------------------------------------------------------------

export type IceStatementLine = {
  indirectPoolId: string;
  lineType: "Account" | "Carried Burden" | "Absorbed Overhead";
  accountNumber: string | null;
  accountName: string | null;
  sourcePoolName: string | null;
  amount: number;
  unallowableAmount: number;
};

/** The account number, the name and the claimed amount of a statement line. */
function statementCells(line: IceStatementLine): (string | number)[] {
  const name =
    line.lineType === "Carried Burden"
      ? `Burden from ${line.sourcePoolName ?? ""}`
      : line.lineType === "Absorbed Overhead"
        ? `Absorbed overhead${line.accountName ? ` (${line.accountName})` : ""}`
        : (line.accountName ?? "");
  // Absorbed overhead is shown, never claimed (B7).
  const claimed =
    line.lineType === "Absorbed Overhead"
      ? 0
      : money(line.amount - line.unallowableAmount);
  return [
    line.lineType === "Carried Burden" ? "" : (line.accountNumber ?? ""),
    name,
    money(line.amount),
    money(line.unallowableAmount),
    claimed
  ];
}

const LINE_ORDER: Record<IceStatementLine["lineType"], number> = {
  Account: 0,
  "Carried Burden": 1,
  "Absorbed Overhead": 2
};

function orderedLines(lines: IceStatementLine[]): IceStatementLine[] {
  return [...lines].sort(
    (a, b) =>
      LINE_ORDER[a.lineType] - LINE_ORDER[b.lineType] ||
      (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")
  );
}

/** B: the statement lines of the G&A pools. */
export function buildScheduleB(
  pools: PoolDef[],
  lines: IceStatementLine[]
): IceTable {
  const ga = new Set(
    pools.filter((pool) => pool.poolType === "G&A").map((pool) => pool.id)
  );
  return {
    fields: [
      "Account number",
      "Account name",
      "Amount",
      "Unallowable",
      "Claimed"
    ],
    rows: orderedLines(lines.filter((line) => ga.has(line.indirectPoolId))).map(
      statementCells
    )
  };
}

/** C: the statement lines of every other pool, by pool in sequence order. */
export function buildScheduleC(
  pools: PoolDef[],
  lines: IceStatementLine[]
): IceTable {
  return {
    fields: [
      "Pool",
      "Account number",
      "Account name",
      "Amount",
      "Unallowable",
      "Claimed"
    ],
    rows: sortPools(pools)
      .filter((pool) => pool.poolType !== "G&A")
      .flatMap((pool) =>
        orderedLines(
          lines.filter((line) => line.indirectPoolId === pool.id)
        ).map((line) => [pool.name, ...statementCells(line)])
      )
  };
}

// -----------------------------------------------------------------------------
// Schedule E: the allocation bases
// -----------------------------------------------------------------------------

const PROJECT_BUCKET_ELEMENT: Record<BaseBucket, string> = {
  Labor: "Labor",
  LaborHours: "Labor (hours)",
  Material: "Material",
  Subcontract: "Subcontract",
  Other: "Other Direct"
};

/**
 * E: each pool's base by element of cost. A GL Base cell takes its account's
 * element of cost (none reads Other Direct); a project cell takes its bucket.
 */
export function buildScheduleE({
  pools,
  mappings,
  glCells,
  projectCells,
  elementOfCostByAccount
}: {
  pools: PoolDef[];
  mappings: PoolMapping[];
  glCells: GlCell[];
  projectCells: ProjectCell[];
  elementOfCostByAccount: Map<string, ElementOfCost | null>;
}): IceTable {
  const rows: (string | number)[][] = [];
  for (const pool of sortPools(pools)) {
    const totals = new Map<string, number>();
    const add = (element: string, amount: number) =>
      totals.set(element, (totals.get(element) ?? 0) + amount);

    const poolMappings = mappings.filter((m) => m.indirectPoolId === pool.id);
    for (const cell of glCells) {
      if (!matchMapping(cell, poolMappings, "Base")) continue;
      add(
        elementOfCostByAccount.get(cell.accountId) ?? "Other Direct",
        cell.amount
      );
    }
    for (const cell of projectCells) {
      if (!projectCellInBase(pool, cell)) continue;
      add(PROJECT_BUCKET_ELEMENT[cell.bucket], cell.amount);
    }
    for (const [element, amount] of [...totals.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      rows.push([pool.name, element, money(amount)]);
    }
  }
  return { fields: ["Pool", "Element of cost", "Base"], rows };
}

// -----------------------------------------------------------------------------
// Schedule G: the reconciliation of direct cost to the books (B15)
// -----------------------------------------------------------------------------

export type DirectCostTotals = {
  /** Non-Burden ledger cost of the Direct projects in the year. */
  ledgerAmount: number;
  unallowableAmount: number;
  /** The journal lines behind those ledger rows, debit-positive. */
  journalAmount: number;
  /** The ledger rows with no journal line. */
  memoAmount: number;
};

/** G: ledger direct cost against the journal lines behind it. */
export function buildScheduleG(totals: DirectCostTotals): IceTable {
  return {
    fields: ["Line", "Amount"],
    rows: [
      ["Direct cost in the project ledger", money(totals.ledgerAmount)],
      ["Less unallowable", money(-totals.unallowableAmount)],
      [
        "Claimed direct cost",
        money(totals.ledgerAmount - totals.unallowableAmount)
      ],
      ["Journal lines behind the ledger rows", money(totals.journalAmount)],
      ["Ledger rows with no journal line", money(totals.memoAmount)],
      [
        "Difference",
        money(totals.ledgerAmount - totals.journalAmount - totals.memoAmount)
      ]
    ]
  };
}

// -----------------------------------------------------------------------------
// Schedules H and I: the cost and the claim by contract
// -----------------------------------------------------------------------------

/** Allowable direct cost by bucket; LaborHours holds hours. */
export type ContractBuckets = Partial<Record<BaseBucket, number>>;

export type IceContract = {
  customerContractId: string;
  contract: string;
  customer: string;
};

const DIRECT_OBJECTIVE: BurdenedCostObjective = "Direct";

/** The burden of one contract's cost at the given rates, per pool. */
function contractBurden(
  pools: PoolDef[],
  rates: Map<string, number>,
  buckets: ContractBuckets,
  absorbedOverhead: number
): Map<string, number> {
  const element: ElementCells = {
    projectId: "",
    projectElementId: null,
    costObjective: DIRECT_OBJECTIVE,
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([bucket, amount]) => [
        bucket,
        { amount: amount ?? 0, unallowableAmount: 0 }
      ])
    ),
    absorbedOverhead
  };
  const targets = projectBurdenTargets(pools, rates, element);
  return new Map(
    [...targets.entries()].map(([poolId, target]) => [poolId, target.allowable])
  );
}

const directTotal = (buckets: ContractBuckets) =>
  (buckets.Labor ?? 0) +
  (buckets.Material ?? 0) +
  (buckets.Subcontract ?? 0) +
  (buckets.Other ?? 0);

/** One contract's claim: direct cost plus burden at the rates. */
export function contractClaim(
  pools: PoolDef[],
  rates: Map<string, number>,
  buckets: ContractBuckets,
  absorbedOverhead = 0
): number {
  const burden = contractBurden(pools, rates, buckets, absorbedOverhead);
  return (
    directTotal(buckets) + [...burden.values()].reduce((sum, b) => sum + b, 0)
  );
}

/**
 * H: per contract, the allowable direct cost by element and the burden of
 * each applied pool at the claimed rates.
 */
export function buildScheduleH({
  pools,
  rates,
  contracts
}: {
  pools: PoolDef[];
  rates: Map<string, number>;
  contracts: (IceContract & {
    buckets: ContractBuckets;
    absorbedOverhead?: number;
  })[];
}): IceTable {
  const applied = sortPools(pools).filter((pool) => pool.appliesToProjects);
  return {
    fields: [
      "Contract",
      "Customer",
      "Labor",
      "Material",
      "Subcontract",
      "Other Direct",
      "Direct total",
      ...applied.map((pool) => pool.name),
      "Total"
    ],
    rows: contracts.map((contract) => {
      const burden = contractBurden(
        applied,
        rates,
        contract.buckets,
        contract.absorbedOverhead ?? 0
      );
      const direct = directTotal(contract.buckets);
      const burdens = applied.map((pool) => burden.get(pool.id) ?? 0);
      return [
        contract.contract,
        contract.customer,
        money(contract.buckets.Labor ?? 0),
        money(contract.buckets.Material ?? 0),
        money(contract.buckets.Subcontract ?? 0),
        money(contract.buckets.Other ?? 0),
        money(direct),
        ...burdens.map(money),
        money(direct + burdens.reduce((sum, b) => sum + b, 0))
      ];
    })
  };
}

/**
 * I: per contract, the claim of the year and of the prior years (each year
 * at its own rates), against what was billed through the year end.
 */
export function buildScheduleI({
  pools,
  fiscalYear,
  ratesByYear,
  contracts
}: {
  pools: PoolDef[];
  fiscalYear: number;
  ratesByYear: Map<number, Map<string, number>>;
  contracts: (IceContract & {
    bucketsByYear: Map<number, ContractBuckets>;
    /** The Overhead ledger rows of each year (B7). */
    absorbedByYear?: Map<number, number>;
    billed: number;
  })[];
}): IceTable {
  const applied = sortPools(pools).filter((pool) => pool.appliesToProjects);
  return {
    fields: [
      "Contract",
      "Claimed this year",
      "Claimed prior years",
      "Cumulative claimed",
      "Cumulative billed",
      "Difference"
    ],
    rows: contracts.map((contract) => {
      let thisYear = 0;
      let priorYears = 0;
      for (const [year, buckets] of contract.bucketsByYear) {
        if (year > fiscalYear) continue;
        const claim = contractClaim(
          applied,
          ratesByYear.get(year) ?? new Map(),
          buckets,
          contract.absorbedByYear?.get(year) ?? 0
        );
        if (year === fiscalYear) thisYear += claim;
        else priorYears += claim;
      }
      const cumulative = thisYear + priorYears;
      return [
        contract.contract,
        money(thisYear),
        money(priorYears),
        money(cumulative),
        money(contract.billed),
        money(cumulative - contract.billed)
      ];
    })
  };
}

// -----------------------------------------------------------------------------
// Schedules K and L: Time & Materials hours and the labor reconciliation
// -----------------------------------------------------------------------------

export type TimeAndMaterialsRow = {
  contract: string;
  contractLine: string;
  laborCategory: string | null;
  hours: number;
  billedAmount: number;
};

/** K: the hours and the billed amount of Time & Materials labor. */
export function buildScheduleK(rows: TimeAndMaterialsRow[]): IceTable {
  return {
    fields: [
      "Contract",
      "Contract line",
      "Labor category",
      "Hours",
      "Billed amount"
    ],
    rows: rows.map((row) => [
      row.contract,
      row.contractLine,
      row.laborCategory ?? "",
      round(row.hours),
      money(row.billedAmount)
    ])
  };
}

export type EmployeeLaborRow = {
  employeeId: string;
  employeeName: string | null;
  grossWages: number;
  hoursPaid: number;
  laborAmount: number;
  laborHours: number;
};

/** L: payroll against the labor the project ledger distributed, per employee. */
export function buildScheduleL(rows: EmployeeLaborRow[]): IceTable {
  return {
    fields: [
      "Employee",
      "Payroll gross wages",
      "Payroll hours",
      "Labor distribution dollars",
      "Labor distribution hours",
      "Difference"
    ],
    rows: [...rows]
      .sort((a, b) =>
        (a.employeeName ?? a.employeeId).localeCompare(
          b.employeeName ?? b.employeeId
        )
      )
      .map((row) => [
        row.employeeName ?? row.employeeId,
        money(row.grossWages),
        round(row.hoursPaid),
        money(row.laborAmount),
        round(row.laborHours),
        money(row.grossWages - row.laborAmount)
      ])
  };
}
