// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Project revenue (`PROJECT_REVENUE`): Cost Plus billing, the Percent Complete
// revenue and the contract loss provision. Server-only
// (`@carbon/ee/project-revenue.server`).
//
// Posting writes Time & Materials items only. The community postings do not
// price Cost Plus, so a Cost Plus line's items come from
// `generateCostPlusItems`, which the nightly job and the line's Generate
// billable items call. Without commercial code a Cost Plus line bills
// nothing. Plan: `.ai/plans/2026-10-09-project-billing-phase-4a.md`
// (decisions P1, P2).
//
// The Percent Complete synthesizer shares the community writers of the
// revenue recognition run (`apps/erp/app/modules/accounting/project-revenue.ts`).
// This package cannot import the ERP, so the run passes them in
// (`projectRevenueSynthesizers(writers)`), typed here as
// `ProjectRevenueWriters`.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  estimateAtCompletion,
  round,
  selectRowsToBill,
  sumSubtree
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { requireEntitlement } from "../entitlements.server";
import { companyHasFeature } from "../plan.server";
import { priceCostPlusItem } from "./pricing";
import {
  lossProvisionBalance,
  percentCompletePrice,
  percentCompleteRevenue
} from "./progress";

type ProjectCostType = Database["public"]["Enums"]["projectCostType"];
type ContractRevenueMethod =
  Database["public"]["Enums"]["contractRevenueMethod"];
type ContractBillingMethod =
  Database["public"]["Enums"]["contractBillingMethod"];

/** What a revenue recognition run synthesizer is given: the run's company,
 *  period end (`YYYY-MM-DD`) and user. */
export type RunProposalContext = {
  companyId: string;
  periodEnd: string;
  userId: string;
};

/** A revenue recognition run synthesizer, run inside the proposal's
 *  transaction before the due rows are selected. */
export type RunRowSynthesizer = (
  trx: KyselyTx,
  ctx: RunProposalContext
) => Promise<void>;

/** A contract line whose revenue is earned by progress. */
export type ProgressLine = {
  id: string;
  customerContractId: string;
  billingMethod: ContractBillingMethod;
  revenueMethod: ContractRevenueMethod;
  projectId: string | null;
  projectElementId: string | null;
  feePercent: number | null;
  ceilingAmount: number | null;
};

/** One line's month of progress revenue, and the figures behind it. */
export type ProgressMonth = {
  line: ProgressLine;
  amount: number;
  earnedToDate: number;
  estimateAtCompletion?: number | null;
  transactionPrice?: number | null;
  progress?: number | null;
};

/** A line's WIP cost on one account that no relief covers yet. */
export type UnrelievedCost = {
  customerContractLineId: string;
  accountId: string;
  amount: number;
  rows: { id: string; amount: number }[];
};

/** The community writers of the revenue recognition run that the Percent
 *  Complete synthesizer shares with the Right to Invoice one. */
export type ProjectRevenueWriters = {
  clearProgressMonth(
    trx: KyselyTx,
    ctx: RunProposalContext,
    args: { lineIds: string[]; monthStart: string }
  ): Promise<string[]>;
  loadProgressLines(
    trx: KyselyTx,
    args: {
      companyId: string;
      periodEnd: string;
      revenueMethods: ContractRevenueMethod[];
    }
  ): Promise<ProgressLine[]>;
  lockProjectRevenue(trx: KyselyTx, companyId: string): Promise<void>;
  monthStartOf(periodEnd: string): string;
  recognizedBefore(
    trx: KyselyTx,
    args: { companyId: string; lineIds: string[]; monthStart: string }
  ): Promise<Map<string, number>>;
  selectUnrelievedCost(
    trx: KyselyTx,
    args: { companyId: string; lineIds: string[]; through: string }
  ): Promise<UnrelievedCost[]>;
  writeCostRelief(
    trx: KyselyTx,
    ctx: RunProposalContext,
    reliefs: UnrelievedCost[]
  ): Promise<void>;
  writeProgressMonths(
    trx: KyselyTx,
    ctx: RunProposalContext,
    months: ProgressMonth[]
  ): Promise<void>;
};

const INSERT_BATCH_SIZE = 1000;

/** The runtime check: a company without the feature degrades (no items). */
export async function projectRevenueEnabledForCompany(
  companyId: string
): Promise<boolean> {
  return companyHasFeature(getCarbonServiceRole(), companyId, {
    feature: "PROJECT_REVENUE"
  });
}

/** The authoring lock: creating a Cost Plus line or choosing Percent
 *  Complete. Throws `EntitlementError`. */
export async function requireProjectRevenueEntitlement(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<void> {
  await requireEntitlement(client, companyId, "PROJECT_REVENUE");
}

type LedgerRow = {
  customerContractLineId: string;
  id: string;
  projectId: string;
  projectElementId: string;
  costType: ProjectCostType;
  amount: number;
  quantity: number | null;
  itemId: string | null;
  reversalOfId: string | null;
  documentType: string;
};

/**
 * Creates the billable items of the live Cost Plus lines (or the one line
 * asked for) for the ledger rows of their billing element subtrees posted on
 * or before `through`. A line is live when its contract is Active and
 * `startDate <= through <= endDate` (no end date: open). Only allowable rows of
 * Contract-treatment projects bill; a row that already has an item, and a
 * reversed pair, are skipped (`selectRowsToBill`). Each item is cost × (1 +
 * fee), Unbilled.
 */
export async function generateCostPlusItems(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    through: string;
    customerContractLineId?: string;
  }
): Promise<{ generated: number; gated: boolean }> {
  const { companyId, userId, through } = args;
  if (!(await projectRevenueEnabledForCompany(companyId))) {
    return { generated: 0, gated: true };
  }

  const run = async (trx: Kysely<KyselyDatabase>) => {
    let linesQuery = trx
      .selectFrom("customerContractLine as l")
      .innerJoin("customerContract as c", (join) =>
        join
          .onRef("c.id", "=", "l.customerContractId")
          .onRef("c.companyId", "=", "l.companyId")
      )
      .select(["l.id", "l.feePercent"])
      .where("l.companyId", "=", companyId)
      .where("l.billingMethod", "=", "Cost Plus")
      .where("c.status", "=", "Active")
      .where("l.startDate", "<=", through)
      .where((eb) =>
        eb.or([eb("l.endDate", "is", null), eb("l.endDate", ">=", through)])
      );
    if (args.customerContractLineId) {
      linesQuery = linesQuery.where("l.id", "=", args.customerContractLineId);
    }
    const lines = await linesQuery.execute();
    if (lines.length === 0) return 0;

    const feeByLine = new Map(
      lines.map((line) => [line.id, Number(line.feePercent ?? 0)])
    );
    const lineIds = lines.map((line) => line.id);

    const { rows } = await sql<LedgerRow>`
      SELECT s."customerContractLineId", pl."id", pl."projectId",
             pl."projectElementId", pl."costType", pl."amount", pl."quantity",
             pl."itemId", pl."reversalOfId", pl."documentType"
      FROM get_contract_line_subtree(${companyId}, ${lineIds}::text[]) s
      JOIN "projectLedger" pl
        ON pl."projectElementId" = s."projectElementId" AND pl."companyId" = ${companyId}
      JOIN "project" p ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
      WHERE pl."postingDate" <= ${through}::date
        AND pl."unallowable" = false
        -- Burden bills through computeBurdenBilling (5b decision B5).
        AND pl."costType" <> 'Burden'
        AND p."costTreatment" = 'Contract'
      ORDER BY pl."postingDate", pl."id"
    `.execute(trx);
    if (rows.length === 0) return 0;

    const billed = await trx
      .selectFrom("projectBillableItem")
      .select("projectLedgerId")
      .where("companyId", "=", companyId)
      .where(
        "projectLedgerId",
        "=",
        sql<string>`ANY(${rows.map((row) => row.id)}::text[])`
      )
      .execute();
    const withItem = new Set(billed.map((item) => item.projectLedgerId));

    const inserts = selectRowsToBill(rows, withItem).map((row) => {
      const price = priceCostPlusItem({
        costType: row.costType,
        cost: Number(row.amount),
        hours: row.quantity === null ? null : Number(row.quantity),
        feePercent: feeByLine.get(row.customerContractLineId) ?? 0
      });
      return {
        companyId,
        projectId: row.projectId,
        projectElementId: row.projectElementId,
        projectLedgerId: row.id,
        customerContractLineId: row.customerContractLineId,
        itemId: row.itemId,
        description: `${row.costType} — ${row.documentType}`,
        quantity: price.quantity,
        unitPrice: price.unitPrice,
        amount: price.amount,
        coverage: null,
        status: "Unbilled" as const,
        statusReason: null,
        createdBy: userId
      };
    });

    for (let i = 0; i < inserts.length; i += INSERT_BATCH_SIZE) {
      await trx
        .insertInto("projectBillableItem")
        .values(inserts.slice(i, i + INSERT_BATCH_SIZE))
        .execute();
    }
    return inserts.length;
  };

  const generated = db.isTransaction
    ? await run(db)
    : await db.transaction().execute(run);
  return { generated, gated: false };
}

type CostSummaryRow = {
  projectId: string;
  projectElementId: string | null;
  planMaterial: number;
  planLabor: number;
  planOther: number;
  committed: number;
  actual: number;
};

/**
 * The Percent Complete synthesizer (commercial), on the run's community
 * `writers` (decision R1: the run takes it from
 * `projectRevenueSynthesizers`). Per Percent Complete line, for the run's
 * month:
 * - the price: a Fixed line's scheduled total, or a Cost Plus line's EAC ×
 *   (1 + fee) capped at the ceiling;
 * - the EAC: the billing element's override, else the subtree roll-up of
 *   `get_project_cost_summary` (the Costs tab's figure);
 * - progress = the subtree's actual cost to the period end ÷ EAC, capped at 1;
 * - the month = price × progress less what is recognized before the month;
 * - the loss provision change, to (EAC − price) × (1 − progress);
 * - the relief of every unrelieved WIP row of the subtree (cost-to-cost).
 * A company without `PROJECT_REVENUE` degrades: the run writes nothing here.
 */
export function synthesizeCommercialProjectRevenue(
  writers: ProjectRevenueWriters
): RunRowSynthesizer {
  const {
    clearProgressMonth,
    loadProgressLines,
    lockProjectRevenue,
    monthStartOf,
    recognizedBefore,
    selectUnrelievedCost,
    writeCostRelief,
    writeProgressMonths
  } = writers;
  return async (trx: KyselyTx, ctx: RunProposalContext) => {
    const { companyId, periodEnd, userId } = ctx;
    if (!(await projectRevenueEnabledForCompany(companyId))) return;

    // A Cost Plus line with Right to Invoice needs its items before the
    // community synthesizer reads them (R10).
    await generateCostPlusItems(trx, { companyId, userId, through: periodEnd });

    await lockProjectRevenue(trx, companyId);
    const lines = await loadProgressLines(trx, {
      companyId,
      periodEnd,
      revenueMethods: ["Percent Complete"]
    });
    if (lines.length === 0) return;

    const monthStart = monthStartOf(periodEnd);
    const openIds = await clearProgressMonth(trx, ctx, {
      lineIds: lines.map((line) => line.id),
      monthStart
    });
    if (openIds.length === 0) return;
    const open = lines.filter(
      (
        line
      ): line is typeof line & {
        projectId: string;
        projectElementId: string;
      } =>
        openIds.includes(line.id) &&
        line.projectId !== null &&
        line.projectElementId !== null
    );
    if (open.length === 0) return;
    const lineIds = open.map((line) => line.id);
    const projectIds = [...new Set(open.map((line) => line.projectId))];

    // 1. The subtree's actual cost to the period end, per line.
    const { rows: actualRows } = await sql<{
      customerContractLineId: string;
      actual: number;
    }>`
    SELECT s."customerContractLineId", COALESCE(SUM(pl."amount"), 0) AS "actual"
    FROM get_contract_line_subtree(${companyId}, ${lineIds}::text[]) s
    JOIN "projectLedger" pl
      ON pl."projectElementId" = s."projectElementId" AND pl."companyId" = ${companyId}
    WHERE pl."postingDate" <= ${periodEnd}::date
    GROUP BY s."customerContractLineId"
  `.execute(trx);
    const actualByLine = new Map(
      actualRows.map((row) => [row.customerContractLineId, Number(row.actual)])
    );

    // 2. Each project's cost summary (one statement for every project) and
    //    those projects' elements.
    const { rows: summaryRows } = await sql<CostSummaryRow>`
    SELECT p."id" AS "projectId", s."projectElementId", s."planMaterial",
           s."planLabor", s."planOther", s."committed", s."actual"
    FROM unnest(${projectIds}::text[]) AS p("id"),
         LATERAL get_project_cost_summary(p."id", ${companyId}) s
  `.execute(trx);
    const summaries = new Map<string, CostSummaryRow[]>();
    for (const row of summaryRows) {
      const list = summaries.get(row.projectId) ?? [];
      list.push({
        ...row,
        planMaterial: Number(row.planMaterial),
        planLabor: Number(row.planLabor),
        planOther: Number(row.planOther),
        committed: Number(row.committed),
        actual: Number(row.actual)
      });
      summaries.set(row.projectId, list);
    }
    const elements = await trx
      .selectFrom("projectElement")
      .select(["id", "parentId", "projectId", "estimateAtCompletion"])
      .where("companyId", "=", companyId)
      .where("projectId", "in", projectIds)
      .execute();
    const elementById = new Map(
      elements.map((element) => [element.id, element])
    );

    // 3. The Fixed lines' scheduled total (their contract value).
    const scheduled = await trx
      .selectFrom("customerContractInvoiceLine")
      .select([
        "customerContractLineId",
        sql<number>`COALESCE(SUM("amount"), 0)`.as("amount")
      ])
      .where("companyId", "=", companyId)
      .where("customerContractLineId", "in", lineIds)
      .groupBy("customerContractLineId")
      .execute();
    const scheduledByLine = new Map(
      scheduled.map((row) => [row.customerContractLineId, Number(row.amount)])
    );

    // 4. The loss provision each line carries from earlier months.
    const provisions = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select([
        "customerContractLineId",
        sql<number>`COALESCE(SUM("amount"), 0)`.as("amount")
      ])
      .where("companyId", "=", companyId)
      .where("type", "=", "Loss Provision")
      .where("customerContractLineId", "in", lineIds)
      .where("periodStart", "<", monthStart)
      .groupBy("customerContractLineId")
      .execute();
    const provisionByLine = new Map(
      provisions.map((row) => [row.customerContractLineId!, Number(row.amount)])
    );

    const before = await recognizedBefore(trx, {
      companyId,
      lineIds,
      monthStart
    });

    const months: ProgressMonth[] = [];
    const provisionChanges: { lineId: string; amount: number }[] = [];
    for (const line of open) {
      const override = elementById.get(
        line.projectElementId
      )?.estimateAtCompletion;
      const eac = round(
        estimateAtCompletion({
          ...sumSubtree(
            summaries.get(line.projectId) ?? [],
            elements.filter((element) => element.projectId === line.projectId),
            line.projectElementId
          ),
          override:
            override === null || override === undefined
              ? null
              : Number(override)
        })
      );
      const price = percentCompletePrice({
        billingMethod: line.billingMethod,
        scheduledTotal: scheduledByLine.get(line.id) ?? 0,
        estimateAtCompletion: eac,
        feePercent: line.feePercent,
        ceilingAmount: line.ceilingAmount
      });
      const { progress, earnedToDate, month } = percentCompleteRevenue({
        price,
        estimateAtCompletion: eac,
        actualToDate: actualByLine.get(line.id) ?? 0,
        recognizedToDate: before.get(line.id) ?? 0
      });
      months.push({
        line,
        amount: month,
        earnedToDate,
        estimateAtCompletion: eac,
        transactionPrice: price,
        progress
      });

      const target = lossProvisionBalance({
        price,
        estimateAtCompletion: eac,
        progress
      });
      const change = round(target - (provisionByLine.get(line.id) ?? 0));
      if (change !== 0)
        provisionChanges.push({ lineId: line.id, amount: change });
    }

    await writeProgressMonths(trx, ctx, months);

    if (provisionChanges.length > 0) {
      const defaults = await trx
        .selectFrom("accountDefault")
        .select(["costOfGoodsSoldAccount", "contractLossProvisionAccount"])
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!defaults?.contractLossProvisionAccount) {
        throw new Error(
          "Set the Contract Loss Provision account default before recognizing contract losses"
        );
      }
      if (!defaults.costOfGoodsSoldAccount) {
        throw new Error(
          "Set the Cost of Goods Sold account default before recognizing project revenue"
        );
      }
      // A negative change releases provision; posting swaps its sides.
      await trx
        .insertInto("revenueRecognitionSchedule")
        .values(
          provisionChanges.map((change) => ({
            companyId,
            type: "Loss Provision" as const,
            status: "Planned" as const,
            customerContractLineId: change.lineId,
            periodStart: monthStart,
            periodEnd,
            scheduledDate: periodEnd,
            amount: change.amount,
            debitAccountId: defaults.costOfGoodsSoldAccount,
            creditAccountId: defaults.contractLossProvisionAccount!,
            createdBy: userId
          }))
        )
        .execute();
    }

    const reliefs = await selectUnrelievedCost(trx, {
      companyId,
      lineIds,
      through: periodEnd
    });
    await writeCostRelief(trx, ctx, reliefs);
  };
}

/** The commercial synthesizers a revenue recognition run runs first
 *  (decision R1), on the run's community `writers`. */
export function projectRevenueSynthesizers(
  writers: ProjectRevenueWriters
): RunRowSynthesizer[] {
  return [synthesizeCommercialProjectRevenue(writers)];
}
