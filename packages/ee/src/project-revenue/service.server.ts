// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Project revenue (`PROJECT_REVENUE`): Cost Plus billing, and in Phase 4b the
// Percent Complete revenue and the contract loss provision. Server-only
// (`@carbon/ee/project-revenue.server`).
//
// Posting writes Time & Materials items only. `@carbon/server-functions`
// cannot import this package (`@carbon/ee` depends on it), so a Cost Plus
// line's items come from `generateCostPlusItems`, which the nightly job and
// the line's Generate billable items call. Without commercial code a Cost Plus
// line bills nothing. Plan: `.ai/plans/2026-10-09-project-billing-phase-4a.md`
// (decisions P1, P2).

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { selectRowsToBill } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { requireEntitlement } from "../entitlements.server";
import { companyHasFeature } from "../plan.server";
import { priceCostPlusItem } from "./pricing";

type ProjectCostType = Database["public"]["Enums"]["projectCostType"];

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
