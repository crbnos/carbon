// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The ICE schedules of one fiscal year (Government Contracting 5b). Each
// schedule loads only what it needs, with the rate run's readers, and reads
// each table once: never per contract or per year (B15).
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (Task 14)

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { MONTH_NUMBER } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { requireEntitlement } from "../entitlements.server";
import { fiscalYearRange, type PoolDef, type PoolMapping } from "./compute";
import {
  buildScheduleA,
  buildScheduleB,
  buildScheduleC,
  buildScheduleE,
  buildScheduleG,
  buildScheduleH,
  buildScheduleI,
  buildScheduleK,
  buildScheduleL,
  type ContractBuckets,
  type IceContract,
  type IceSchedule,
  type IceStatementLine,
  type IceTable
} from "./ice";
import { loadGlCells, loadProjectCells } from "./loaders.server";
import { type BaseBucket, PROJECT_BASE_BUCKETS } from "./models";

type Db = Kysely<KyselyDatabase>;
type ProjectCostType = Database["public"]["Enums"]["projectCostType"];

/** The fiscal year's first month and dates. */
async function loadFiscalYear(db: Db, companyId: string, fiscalYear: number) {
  const settings = await db
    .selectFrom("fiscalYearSettings")
    .select("startMonth")
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const startMonth = MONTH_NUMBER[settings?.startMonth ?? "January"] ?? 1;
  const periodEnd = (periodNumber: number) =>
    fiscalYearRange(fiscalYear, periodNumber, startMonth).periodEnd;
  return {
    startMonth,
    start: fiscalYearRange(fiscalYear, 1, startMonth).start,
    end: periodEnd(12),
    periodEnd
  };
}

/** Every pool of the company, in sequence order. */
async function loadPools(db: Db, companyId: string): Promise<PoolDef[]> {
  return db
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
    .orderBy("sequence")
    .execute();
}

/** The last period of the year with Actual rates, or null. */
async function lastComputedPeriod(
  db: Db,
  companyId: string,
  fiscalYear: number
): Promise<number | null> {
  const row = await db
    .selectFrom("indirectRate")
    .select((eb) => eb.fn.max("periodNumber").as("periodNumber"))
    .where("companyId", "=", companyId)
    .where("fiscalYear", "=", fiscalYear)
    .where("rateType", "=", "Actual")
    .executeTakeFirst();
  return row?.periodNumber ?? null;
}

/**
 * The claimed rate of each pool per fiscal year, up to `fiscalYear`: the
 * Final rate of period 12, else the Actual rate of the last computed period.
 */
async function loadClaimedRates(
  db: Db,
  companyId: string,
  fiscalYear: number
): Promise<Map<number, Map<string, number>>> {
  const rows = await db
    .selectFrom("indirectRate")
    .select([
      "indirectPoolId",
      "fiscalYear",
      "periodNumber",
      "rateType",
      "ytdRate"
    ])
    .where("companyId", "=", companyId)
    .where("fiscalYear", "<=", fiscalYear)
    .where((eb) =>
      eb.or([
        eb.and([eb("rateType", "=", "Final"), eb("periodNumber", "=", 12)]),
        eb("rateType", "=", "Actual")
      ])
    )
    .orderBy("periodNumber", "desc")
    .execute();

  const final = new Map<string, number>();
  const actual = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.fiscalYear}|${row.indirectPoolId}`;
    const target = row.rateType === "Final" ? final : actual;
    if (!target.has(key)) target.set(key, Number(row.ytdRate));
  }
  const byYear = new Map<number, Map<string, number>>();
  for (const [key, rate] of [...actual.entries(), ...final.entries()]) {
    const [year, poolId] = key.split("|");
    const rates = byYear.get(Number(year)) ?? new Map<string, number>();
    // Final entries come last, so a Final rate replaces the Actual rate.
    rates.set(poolId!, rate);
    byYear.set(Number(year), rates);
  }
  return byYear;
}

/** Adds a ledger sum to its buckets; the LaborHours bucket takes hours. */
function addToBuckets(
  buckets: ContractBuckets,
  costType: ProjectCostType,
  amount: number,
  quantity: number
) {
  for (const bucket of PROJECT_BASE_BUCKETS[costType] ?? []) {
    const value = bucket === "LaborHours" ? quantity : amount;
    buckets[bucket as BaseBucket] =
      (buckets[bucket as BaseBucket] ?? 0) + value;
  }
}

/** The fiscal year of a date column, as SQL (`fiscalYearAndPeriodFor`). */
function fiscalYearOf(column: string, startMonth: number) {
  return startMonth === 1
    ? sql<number>`EXTRACT(YEAR FROM ${sql.ref(column)})::int`
    : sql<number>`(EXTRACT(YEAR FROM ${sql.ref(column)})
        + CASE WHEN EXTRACT(MONTH FROM ${sql.ref(column)}) >= ${sql.lit(startMonth)} THEN 1 ELSE 0 END)::int`;
}

/**
 * Allowable non-Burden ledger cost of the Direct projects on each current
 * contract line's billing element subtree, per contract, fiscal year and
 * cost type, through `to`. One statement.
 */
async function loadContractCost(
  db: Db,
  {
    companyId,
    from,
    to,
    startMonth
  }: { companyId: string; from: string | null; to: string; startMonth: number }
) {
  const fy = fiscalYearOf("pl.postingDate", startMonth);
  const { rows } = await sql<{
    customerContractId: string;
    contract: string;
    customer: string | null;
    fiscalYear: number;
    costType: ProjectCostType;
    amount: number;
    quantity: number;
  }>`
    WITH lines AS (
      -- A Draft contract is not awarded: its billing elements would count
      -- the same cost a second time beside the confirmed contract's.
      SELECT l."id", l."customerContractId" FROM "customerContractLine" l
      JOIN "customerContract" lc
        ON lc."id" = l."customerContractId" AND lc."companyId" = l."companyId"
      WHERE l."companyId" = ${companyId}
        AND lc."status" <> 'Draft'
        AND l."projectElementId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "customerContractLine" n
          WHERE n."amendsLineId" = l."id" AND n."companyId" = l."companyId"
        )
    )
    SELECT c."id" AS "customerContractId", c."customerContractId" AS "contract",
      cu."name" AS "customer", ${fy} AS "fiscalYear", pl."costType",
      SUM(pl."amount") AS "amount", SUM(COALESCE(pl."quantity", 0)) AS "quantity"
    FROM get_contract_line_subtree(${companyId}, ARRAY(SELECT "id" FROM lines)) s
    JOIN lines ON lines."id" = s."customerContractLineId"
    JOIN "customerContract" c
      ON c."id" = lines."customerContractId" AND c."companyId" = ${companyId}
    LEFT JOIN "customer" cu ON cu."id" = c."customerId" AND cu."companyId" = c."companyId"
    JOIN "projectLedger" pl
      ON pl."projectElementId" = s."projectElementId" AND pl."companyId" = ${companyId}
    JOIN "project" p ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
    WHERE p."costObjective" = 'Direct'
      AND pl."costType" <> 'Burden'
      AND NOT pl."unallowable"
      AND (${from}::date IS NULL OR pl."postingDate" >= ${from}::date)
      AND pl."postingDate" <= ${to}::date
    GROUP BY c."id", c."customerContractId", cu."name", 4, pl."costType"
    ORDER BY c."customerContractId"
  `.execute(db);
  return rows;
}

type ContractYear = IceContract & {
  bucketsByYear: Map<number, ContractBuckets>;
  absorbedByYear: Map<number, number>;
};

function groupContractCost(
  rows: Awaited<ReturnType<typeof loadContractCost>>
): ContractYear[] {
  const contracts = new Map<string, ContractYear>();
  for (const row of rows) {
    const contract = contracts.get(row.customerContractId) ?? {
      customerContractId: row.customerContractId,
      contract: row.contract,
      customer: row.customer ?? "",
      bucketsByYear: new Map(),
      absorbedByYear: new Map()
    };
    const buckets = contract.bucketsByYear.get(row.fiscalYear) ?? {};
    addToBuckets(
      buckets,
      row.costType,
      Number(row.amount),
      Number(row.quantity)
    );
    contract.bucketsByYear.set(row.fiscalYear, buckets);
    if (row.costType === "Overhead") {
      contract.absorbedByYear.set(
        row.fiscalYear,
        (contract.absorbedByYear.get(row.fiscalYear) ?? 0) + Number(row.amount)
      );
    }
    contracts.set(row.customerContractId, contract);
  }
  return [...contracts.values()];
}

async function loadStatementLines(
  db: Db,
  companyId: string,
  fiscalYear: number,
  periodNumber: number
): Promise<IceStatementLine[]> {
  const { rows } = await sql<IceStatementLine>`
    SELECT s."indirectPoolId", s."lineType", a."number" AS "accountNumber",
      a."name" AS "accountName", sp."name" AS "sourcePoolName",
      s."amount", s."unallowableAmount"
    FROM "indirectExpenseStatement" s
    LEFT JOIN "account" a ON a."id" = s."accountId"
    LEFT JOIN "indirectPool" sp
      ON sp."id" = s."sourcePoolId" AND sp."companyId" = s."companyId"
    WHERE s."companyId" = ${companyId}
      AND s."fiscalYear" = ${fiscalYear}
      AND s."periodNumber" = ${periodNumber}
  `.execute(db);
  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    unallowableAmount: Number(row.unallowableAmount)
  }));
}

/**
 * One ICE schedule of a fiscal year, as fields and rows. A, B, C and E read
 * the last period of the year with Actual rates; with none, they are empty.
 */
export async function buildIceSchedule(
  db: Db,
  client: SupabaseClient<Database>,
  {
    companyId,
    fiscalYear,
    schedule
  }: { companyId: string; fiscalYear: number; schedule: IceSchedule }
): Promise<IceTable> {
  await requireEntitlement(client, companyId, "GOVERNMENT_CONTRACTING");
  const year = await loadFiscalYear(db, companyId, fiscalYear);

  switch (schedule) {
    case "A":
    case "B":
    case "C":
    case "E": {
      const [pools, period] = await Promise.all([
        loadPools(db, companyId),
        lastComputedPeriod(db, companyId, fiscalYear)
      ]);
      if (schedule === "A") {
        const actual =
          period === null
            ? []
            : await db
                .selectFrom("indirectRate")
                .select(["indirectPoolId", "poolCost", "baseAmount", "ytdRate"])
                .where("companyId", "=", companyId)
                .where("fiscalYear", "=", fiscalYear)
                .where("periodNumber", "=", period)
                .where("rateType", "=", "Actual")
                .execute();
        return buildScheduleA(
          pools,
          actual.map((row) => ({
            indirectPoolId: row.indirectPoolId,
            poolCost: Number(row.poolCost ?? 0),
            baseAmount: Number(row.baseAmount ?? 0),
            ytdRate: Number(row.ytdRate)
          }))
        );
      }
      if (schedule === "B" || schedule === "C") {
        const lines =
          period === null
            ? []
            : await loadStatementLines(db, companyId, fiscalYear, period);
        return schedule === "B"
          ? buildScheduleB(pools, lines)
          : buildScheduleC(pools, lines);
      }

      const to = period === null ? year.end : year.periodEnd(period);
      const mappings: PoolMapping[] =
        pools.length === 0
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
              .where("role", "=", "Base")
              .execute();
      const range = { companyId, from: year.start, to };
      const [glCells, projectCells, accounts] = await Promise.all([
        loadGlCells(db, { ...range, mappings }),
        loadProjectCells(db, range),
        mappings.length === 0
          ? Promise.resolve([])
          : db
              .selectFrom("account")
              .select(["id", "elementOfCost"])
              .where("id", "in", [...new Set(mappings.map((m) => m.accountId))])
              .execute()
      ]);
      return buildScheduleE({
        pools,
        mappings,
        glCells,
        projectCells,
        elementOfCostByAccount: new Map(
          accounts.map((account) => [account.id, account.elementOfCost])
        )
      });
    }

    case "G": {
      const { rows } = await sql<{
        ledgerAmount: number | null;
        unallowableAmount: number | null;
        memoAmount: number | null;
        journalAmount: number | null;
      }>`
        WITH rows AS (
          SELECT pl."amount", pl."unallowable", pl."journalLineId"
          FROM "projectLedger" pl
          JOIN "project" p ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
          WHERE pl."companyId" = ${companyId}
            AND p."costObjective" = 'Direct'
            AND pl."costType" <> 'Burden'
            AND pl."postingDate" BETWEEN ${year.start}::date AND ${year.end}::date
        )
        SELECT
          (SELECT SUM("amount") FROM rows) AS "ledgerAmount",
          (SELECT SUM("amount") FROM rows WHERE "unallowable") AS "unallowableAmount",
          (SELECT SUM("amount") FROM rows WHERE "journalLineId" IS NULL) AS "memoAmount",
          (
            SELECT SUM(CASE WHEN a."class" IN ('Liability', 'Equity', 'Revenue')
              THEN -jl."amount" ELSE jl."amount" END)
            FROM "journalLine" jl
            JOIN "account" a ON a."id" = jl."accountId"
            WHERE jl."companyId" = ${companyId}
              AND jl."id" IN (SELECT DISTINCT "journalLineId" FROM rows WHERE "journalLineId" IS NOT NULL)
          ) AS "journalAmount"
      `.execute(db);
      const row = rows[0];
      return buildScheduleG({
        ledgerAmount: Number(row?.ledgerAmount ?? 0),
        unallowableAmount: Number(row?.unallowableAmount ?? 0),
        memoAmount: Number(row?.memoAmount ?? 0),
        journalAmount: Number(row?.journalAmount ?? 0)
      });
    }

    case "H": {
      const [pools, ratesByYear, cost] = await Promise.all([
        loadPools(db, companyId),
        loadClaimedRates(db, companyId, fiscalYear),
        loadContractCost(db, {
          companyId,
          from: year.start,
          to: year.end,
          startMonth: year.startMonth
        })
      ]);
      return buildScheduleH({
        pools,
        rates: ratesByYear.get(fiscalYear) ?? new Map(),
        contracts: groupContractCost(cost).map((contract) => ({
          ...contract,
          buckets: contract.bucketsByYear.get(fiscalYear) ?? {},
          absorbedOverhead: contract.absorbedByYear.get(fiscalYear) ?? 0
        }))
      });
    }

    case "I": {
      const [pools, ratesByYear, cost, billed] = await Promise.all([
        loadPools(db, companyId),
        loadClaimedRates(db, companyId, fiscalYear),
        loadContractCost(db, {
          companyId,
          from: null,
          to: year.end,
          startMonth: year.startMonth
        }),
        sql<{ customerContractId: string; amount: number }>`
          SELECT l."customerContractId", SUM(b."amount") AS "amount"
          FROM "projectBillableItem" b
          JOIN "customerContractLine" l
            ON l."id" = b."customerContractLineId" AND l."companyId" = b."companyId"
          JOIN "salesInvoiceLine" sil
            ON sil."id" = b."salesInvoiceLineId" AND sil."companyId" = b."companyId"
          JOIN "salesInvoice" si
            ON si."id" = sil."invoiceId" AND si."companyId" = sil."companyId"
          WHERE b."companyId" = ${companyId}
            AND b."status" = 'Billed'
            AND si."postingDate" <= ${year.end}::date
          GROUP BY l."customerContractId"
        `.execute(db)
      ]);
      const billedByContract = new Map(
        billed.rows.map((row) => [row.customerContractId, Number(row.amount)])
      );
      return buildScheduleI({
        pools,
        fiscalYear,
        ratesByYear,
        contracts: groupContractCost(cost).map((contract) => ({
          ...contract,
          billed: billedByContract.get(contract.customerContractId) ?? 0
        }))
      });
    }

    case "K": {
      const { rows } = await sql<{
        contract: string;
        contractLine: string;
        laborCategory: string | null;
        hours: number;
        billedAmount: number;
      }>`
        SELECT c."customerContractId" AS "contract",
          COALESCE(l."lineItemNumber", l."description", l."id") AS "contractLine",
          lc."name" AS "laborCategory",
          SUM(COALESCE(pl."quantity", 0)) AS "hours",
          SUM(b."amount") AS "billedAmount"
        FROM "projectBillableItem" b
        JOIN "projectLedger" pl
          ON pl."id" = b."projectLedgerId" AND pl."companyId" = b."companyId"
        JOIN "customerContractLine" l
          ON l."id" = b."customerContractLineId" AND l."companyId" = b."companyId"
        JOIN "customerContract" c
          ON c."id" = l."customerContractId" AND c."companyId" = l."companyId"
        LEFT JOIN "laborCategory" lc
          ON lc."id" = pl."laborCategoryId" AND lc."companyId" = pl."companyId"
        WHERE b."companyId" = ${companyId}
          AND b."status" = 'Billed'
          AND l."billingMethod" = 'Time & Materials'
          AND pl."costType" = 'Labor'
          AND pl."postingDate" BETWEEN ${year.start}::date AND ${year.end}::date
        GROUP BY c."customerContractId", 2, lc."name"
        ORDER BY c."customerContractId", 2, lc."name"
      `.execute(db);
      return buildScheduleK(
        rows.map((row) => ({
          ...row,
          hours: Number(row.hours),
          billedAmount: Number(row.billedAmount)
        }))
      );
    }

    case "L": {
      // The grouping of `getLaborDistributionRows` (projects.service.ts),
      // by employee only.
      const { rows } = await sql<{
        employeeId: string;
        employeeName: string | null;
        grossWages: number;
        hoursPaid: number;
        laborAmount: number;
        laborHours: number;
      }>`
        WITH payroll AS (
          SELECT pt."employeeId", SUM(pt."grossWages") AS "grossWages",
            SUM(pt."hoursPaid") AS "hoursPaid"
          FROM "payrollPeriodTotal" pt
          WHERE pt."companyId" = ${companyId}
            AND pt."periodEnd" BETWEEN ${year.start}::date AND ${year.end}::date
          GROUP BY pt."employeeId"
        ),
        labor AS (
          SELECT pl."employeeId", SUM(pl."amount") AS "laborAmount",
            SUM(COALESCE(pl."quantity", 0)) AS "laborHours"
          FROM "projectLedger" pl
          WHERE pl."companyId" = ${companyId}
            AND pl."costType" = 'Labor'
            AND pl."employeeId" IS NOT NULL
            AND pl."postingDate" BETWEEN ${year.start}::date AND ${year.end}::date
          GROUP BY pl."employeeId"
        )
        SELECT COALESCE(p."employeeId", l."employeeId") AS "employeeId",
          u."fullName" AS "employeeName",
          COALESCE(p."grossWages", 0) AS "grossWages",
          COALESCE(p."hoursPaid", 0) AS "hoursPaid",
          COALESCE(l."laborAmount", 0) AS "laborAmount",
          COALESCE(l."laborHours", 0) AS "laborHours"
        FROM payroll p
        FULL OUTER JOIN labor l ON l."employeeId" = p."employeeId"
        LEFT JOIN "user" u ON u."id" = COALESCE(p."employeeId", l."employeeId")
      `.execute(db);
      return buildScheduleL(
        rows.map((row) => ({
          ...row,
          grossWages: Number(row.grossWages),
          hoursPaid: Number(row.hoursPaid),
          laborAmount: Number(row.laborAmount),
          laborHours: Number(row.laborHours)
        }))
      );
    }

    default:
      return { fields: [], rows: [] };
  }
}
