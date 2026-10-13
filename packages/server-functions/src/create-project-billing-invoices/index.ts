// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project billing invoices: per Active contract with a billing line (Time &
// Materials or Cost Plus), one Draft invoice for the Unbilled items posted on
// or before the latest billing period end, within each line's funding. Shared
// by the contract page and the nightly recurring billing job. Posting stays
// with post-sales-invoice.
// Plan: .ai/plans/2026-10-09-project-billing-phase-4a.md (Task 10, P10, P11).

import { toBaseAmount } from "@carbon/database/accounting-currency";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { billingGrid } from "@carbon/database/contract-schedule";
import {
  BILLABLE_REASON_FUNDING_LIMIT,
  DEFAULT_CURRENCY_DECIMALS,
  datetime,
  effectiveInvoiceAutomation,
  type ProjectInvoicePlanItem,
  planProjectInvoiceLines,
  projectInvoiceHold,
  takeWithinFunding
} from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import type {
  ContractInvoiceGenerationFailure,
  ContractInvoiceGenerationResult,
  DraftedContractInvoice
} from "../create-contract-invoices";
import {
  contractLocationId,
  type InvoiceLineValues,
  insertDraftContractInvoice
} from "../create-contract-invoices/insert-invoice";
import { defineServerFn } from "../define-server-fn";
import { generateTimeAndMaterialsItems } from "../lib/project-posting";
import {
  type ContractLineRow,
  loadContractForUpdate,
  type Scope,
  toTerms
} from "../post-customer-contract/schedule-writes";
import {
  acrnPositions,
  type ClinAllocation,
  type ClinSection,
  planClinSections
} from "./clin";

export type ProjectBillingInvoiceArgs = {
  companyId: string;
  userId: string;
  /** `YYYY-MM-DD` in the company's timezone. */
  asOf: string;
  /** Draft one contract only (the contract page's action). */
  customerContractId?: string;
};

type BillingItem = ProjectInvoicePlanItem & {
  customerContractLineId: string;
  postingDate: string;
  voidedSalesInvoiceId: string | null;
};

const isBillingLine = (line: ContractLineRow) =>
  line.billingMethod !== "Fixed" && line.projectElementId !== null;

/**
 * Drafts the project billing invoices of every Active contract with a
 * billing line that has started by `asOf`. Each contract is its own
 * transaction, so one contract's failure never rolls back another's invoice.
 * A taken item is stamped Billed with its invoice line, which is what makes a
 * second call for the same day a no-op.
 */
export async function createProjectBillingInvoicesForContracts(
  db: Kysely<KyselyDatabase>,
  args: ProjectBillingInvoiceArgs
): Promise<ContractInvoiceGenerationResult> {
  const { companyId, asOf } = args;

  // An ended line can still hold Unbilled items, so the read asks for a
  // started billing line, not one live on `asOf`.
  let query = db
    .selectFrom("customerContract as c")
    .select("c.id")
    .where("c.companyId", "=", companyId)
    .where("c.status", "=", "Active")
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("customerContractLine as l")
          .select("l.id")
          .whereRef("l.customerContractId", "=", "c.id")
          .whereRef("l.companyId", "=", "c.companyId")
          .where("l.billingMethod", "<>", "Fixed")
          .where("l.projectElementId", "is not", null)
          .where("l.startDate", "<=", asOf)
      )
    )
    .orderBy("c.customerContractId");
  if (args.customerContractId) {
    query = query.where("c.id", "=", args.customerContractId);
  }
  const contracts = await query.execute();

  const invoices: DraftedContractInvoice[] = [];
  const failures: ContractInvoiceGenerationFailure[] = [];
  for (const contract of contracts) {
    try {
      const drafted = await db
        .transaction()
        .execute((trx) => processContract(trx, args, contract.id));
      if (drafted) invoices.push(drafted);
    } catch (error) {
      failures.push({
        customerContractId: contract.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { invoices, invoiceIds: invoices.map((i) => i.invoiceId), failures };
}

async function processContract(
  trx: KyselyTx,
  args: ProjectBillingInvoiceArgs,
  contractId: string
): Promise<DraftedContractInvoice | null> {
  const { companyId, userId, asOf } = args;
  const scope: Scope = { companyId, userId };

  // 1. Lock and load.
  const { contract, lines } = await loadContractForUpdate(
    trx,
    companyId,
    contractId
  );
  if (contract.status !== "Active") return null;
  const billingLines = lines.filter(isBillingLine);
  if (billingLines.length === 0) return null;

  // 2. The latest billing period that has ended by `asOf`.
  const periodEnd = billingGrid(toTerms(contract), asOf)
    .map((period) => period.end)
    .filter((end) => end <= asOf)
    .sort()
    .at(-1);
  if (!periodEnd) return null;

  // 3. Rows the job-completion SQL wrote skip posting's hook: bill them now.
  for (const line of billingLines) {
    if (line.billingMethod !== "Time & Materials") continue;
    if (line.startDate > periodEnd) continue;
    await generateTimeAndMaterialsItems(trx, {
      companyId,
      userId,
      customerContractLineId: line.id,
      through:
        line.endDate !== null && line.endDate < periodEnd
          ? line.endDate
          : periodEnd
    });
  }

  const lineIds = billingLines.map((line) => line.id);
  const now = datetime.timestamp();

  // 4. A funding hold is decided again on every run.
  await trx
    .updateTable("projectBillableItem")
    .set({ statusReason: null, updatedBy: userId, updatedAt: now })
    .where("companyId", "=", companyId)
    .where("customerContractLineId", "in", lineIds)
    .where("status", "=", "Unbilled")
    .where("statusReason", "=", BILLABLE_REASON_FUNDING_LIMIT)
    .execute();

  // 5. The Unbilled items of the period, oldest first, locked. A burden item
  // has no ledger row: it carries its own posting date and its pool.
  const postingDate = sql<string>`COALESCE(pl."postingDate", b."postingDate")`;
  const rows = await trx
    .selectFrom("projectBillableItem as b")
    .leftJoin("projectLedger as pl", (join) =>
      join
        .onRef("pl.id", "=", "b.projectLedgerId")
        .onRef("pl.companyId", "=", "b.companyId")
    )
    .leftJoin("laborCategory as lc", (join) =>
      join
        .onRef("lc.id", "=", "pl.laborCategoryId")
        .onRef("lc.companyId", "=", "pl.companyId")
    )
    .leftJoin("indirectPool as ip", (join) =>
      join
        .onRef("ip.id", "=", "b.indirectPoolId")
        .onRef("ip.companyId", "=", "b.companyId")
    )
    .select([
      "b.id",
      "b.customerContractLineId",
      "b.quantity",
      "b.unitPrice",
      "b.amount",
      "b.voidedSalesInvoiceId",
      "b.indirectPoolId",
      postingDate.as("postingDate"),
      "pl.costType",
      "pl.laborCategoryId",
      "lc.name as laborCategoryName",
      "ip.name as poolName"
    ])
    .where("b.companyId", "=", companyId)
    .where("b.customerContractLineId", "in", lineIds)
    .where("b.status", "=", "Unbilled")
    .where(postingDate, "<=", periodEnd)
    .orderBy(postingDate)
    .orderBy("b.id")
    .forUpdate("b")
    .execute();
  if (rows.length === 0) return null;

  const methodByLine = new Map(
    billingLines.map((line) => [line.id, line.billingMethod])
  );
  const items: BillingItem[] = rows.map((row) => ({
    id: row.id,
    customerContractLineId: row.customerContractLineId as string,
    postingDate: row.postingDate,
    costType: row.costType ?? "Burden",
    laborCategoryId: row.laborCategoryId,
    laborCategoryName: row.laborCategoryName,
    indirectPoolId: row.indirectPoolId,
    poolName: row.poolName,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    amount: Number(row.amount),
    billingMethod: methodByLine.get(row.customerContractLineId as string)!,
    voidedSalesInvoiceId: row.voidedSalesInvoiceId
  }));

  // 6. Each line's funding position, one read.
  const { rows: funding } = await sql<{
    customerContractLineId: string;
    billed: number;
  }>`
    SELECT "customerContractLineId", "billed"
    FROM get_contract_line_funding(${companyId}, ${lineIds}::text[], ${asOf}::date)
  `.execute(trx);
  const billedByLine = new Map(
    funding.map((row) => [row.customerContractLineId, Number(row.billed)])
  );

  // 7. Per line, in line order: take what the funding covers, hold the rest.
  const taken: { line: ContractLineRow; items: BillingItem[] }[] = [];
  const heldIds: string[] = [];
  for (const line of billingLines) {
    const own = items.filter((item) => item.customerContractLineId === line.id);
    if (own.length === 0) continue;
    const { take, held } = takeWithinFunding(own, {
      billed: billedByLine.get(line.id) ?? 0,
      fundedAmount:
        line.fundedAmount === null ? null : Number(line.fundedAmount)
    });
    heldIds.push(...held.map((item) => item.id));
    if (take.length > 0) taken.push({ line, items: take });
  }
  if (heldIds.length > 0) {
    await trx
      .updateTable("projectBillableItem")
      .set({
        statusReason: BILLABLE_REASON_FUNDING_LIMIT,
        updatedBy: userId,
        updatedAt: now
      })
      .where("companyId", "=", companyId)
      .where("id", "in", heldIds)
      .execute();
  }
  if (taken.length === 0) return null;

  // 8. The invoice lines: per contract line, the grouped items.
  const itemIds = [...new Set(taken.map(({ line }) => line.itemId))];
  const catalog = await trx
    .selectFrom("item")
    .select(["id", "name", "unitOfMeasureCode", "defaultMethodType"])
    .where("id", "in", itemIds)
    .where("companyId", "=", companyId)
    .execute();
  const itemById = new Map(catalog.map((item) => [item.id, item]));

  type PlannedLine = InvoiceLineValues & {
    customerContractLineId: string;
    billableItemIds: string[];
  };
  const plannedLines: PlannedLine[] = [];
  for (const { line, items: lineItems } of taken) {
    const item = itemById.get(line.itemId);
    for (const planned of planProjectInvoiceLines(lineItems)) {
      plannedLines.push({
        itemId: line.itemId,
        description: planned.description,
        quantity: planned.quantity,
        unitPrice: toBaseAmount(
          planned.unitPrice,
          Number(contract.exchangeRate)
        ),
        discountPercent: 0,
        taxPercent: Number(line.taxPercent),
        serviceStartDate: null,
        serviceEndDate: null,
        customerContractId: contract.id,
        customerContractLineId: line.id,
        customerContractInvoiceLineId: null,
        projectId: line.projectId ?? contract.projectId,
        methodType: item?.defaultMethodType ?? "Pull from Inventory",
        unitOfMeasureCode: item?.unitOfMeasureCode ?? "EA",
        billableItemIds: planned.itemIds
      });
    }
  }

  // 8a. Invoice by CLIN (Government Contracting 5a): a comment line heads
  // each numbered line's lines, and its amount is allocated to its ACRNs.
  // With no number on any line, the invoice is unchanged.
  const numberedLineIds = taken
    .filter(({ line }) => line.lineItemNumber !== null)
    .map(({ line }) => line.id);
  let sections: ClinSection<PlannedLine>[] = plannedLines.map((line) => ({
    type: "line",
    line
  }));
  let allocations: ClinAllocation[] = [];
  if (numberedLineIds.length > 0) {
    const fundingRows = await trx
      .selectFrom("customerContractFunding")
      .select([
        "customerContractLineId",
        "acrn",
        "fundedDate",
        "fundedCost",
        "fundedFee"
      ])
      .where("companyId", "=", companyId)
      .where("customerContractLineId", "in", numberedLineIds)
      .execute();
    const billedRows = await trx
      .selectFrom("salesInvoiceFundingAllocation as a")
      .innerJoin("salesInvoice as si", (join) =>
        join
          .onRef("si.id", "=", "a.salesInvoiceId")
          .onRef("si.companyId", "=", "a.companyId")
      )
      .select(["a.customerContractLineId", "a.acrn", "a.amount"])
      .where("a.companyId", "=", companyId)
      .where("a.customerContractLineId", "in", numberedLineIds)
      .where("si.status", "<>", "Voided")
      .execute();
    const currency = await trx
      .selectFrom("currency")
      .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
      .select("currency.decimalPlaces")
      .where("company.id", "=", companyId)
      .where("currency.code", "=", contract.currencyCode)
      .executeTakeFirst();
    const planned = planClinSections(
      plannedLines,
      taken.map(({ line }) => ({
        id: line.id,
        lineItemNumber: line.lineItemNumber,
        description:
          line.description || itemById.get(line.itemId)?.name || line.itemId
      })),
      acrnPositions(
        fundingRows.map((row) => ({
          ...row,
          fundedCost: Number(row.fundedCost),
          fundedFee: Number(row.fundedFee)
        })),
        billedRows.map((row) => ({ ...row, amount: Number(row.amount) }))
      ),
      // Only the comment's figures read it; the amounts stay unrounded.
      { decimalPlaces: currency?.decimalPlaces ?? DEFAULT_CURRENCY_DECIMALS }
    );
    sections = planned.sections;
    allocations = planned.allocations;
  }

  const invoiceLines: InvoiceLineValues[] = [];
  const itemIdsByInvoiceLine: string[][] = [];
  for (const section of sections) {
    if (section.type === "comment") {
      invoiceLines.push({
        invoiceLineType: "Comment",
        itemId: null,
        description: section.description,
        quantity: 0,
        unitPrice: 0,
        discountPercent: 0,
        taxPercent: 0,
        serviceStartDate: null,
        serviceEndDate: null,
        customerContractId: contract.id,
        customerContractLineId: null,
        customerContractInvoiceLineId: null,
        projectId: null,
        methodType: "Pull from Inventory",
        unitOfMeasureCode: "EA"
      });
      itemIdsByInvoiceLine.push([]);
      continue;
    }
    const { billableItemIds, ...values } = section.line;
    invoiceLines.push(values);
    itemIdsByInvoiceLine.push(billableItemIds);
  }

  // 9. The hold, from the effective invoice automation.
  const takenItems = taken.flatMap(({ items: lineItems }) => lineItems);
  const voidedIds = [
    ...new Set(
      takenItems
        .map((item) => item.voidedSalesInvoiceId)
        .filter((id): id is string => !!id)
    )
  ];
  const settings = await trx
    .selectFrom("companySettings")
    .select("invoiceAutomation")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const voided =
    voidedIds.length === 0
      ? []
      : await trx
          .selectFrom("salesInvoice")
          .select(["id", "invoiceId"])
          .where("companyId", "=", companyId)
          .where("id", "in", voidedIds)
          .execute();
  const voidedReadable = new Map(voided.map((row) => [row.id, row.invoiceId]));
  const mode = effectiveInvoiceAutomation(
    contract.invoiceAutomation,
    settings.invoiceAutomation
  );
  const holdReason = projectInvoiceHold(
    mode,
    takenItems.map((item) => ({
      amount: item.amount,
      voidedInvoiceReadableId: item.voidedSalesInvoiceId
        ? (voidedReadable.get(item.voidedSalesInvoiceId) ??
          item.voidedSalesInvoiceId)
        : null
    }))
  );

  // 10. Draft the invoice, then stamp each taken item with its line.
  const locationId = await contractLocationId(trx, companyId, contract);
  const { invoiceId, lineIds: invoiceLineIds } =
    await insertDraftContractInvoice(trx, scope, {
      asOf,
      contract,
      locationId,
      holdReason,
      lines: invoiceLines
    });

  if (allocations.length > 0) {
    await trx
      .insertInto("salesInvoiceFundingAllocation")
      .values(
        allocations.map((allocation) => ({
          salesInvoiceId: invoiceId,
          customerContractLineId: allocation.customerContractLineId,
          acrn: allocation.acrn,
          amount: allocation.amount,
          companyId,
          createdBy: userId
        }))
      )
      .execute();
  }

  const stamps = itemIdsByInvoiceLine.flatMap((billableItemIds, index) =>
    billableItemIds.map((billableItemId) => ({
      billableItemId,
      lineId: invoiceLineIds[index]!
    }))
  );
  await sql`
    UPDATE "projectBillableItem" b
    SET "salesInvoiceLineId" = v."lineId",
        "status" = 'Billed',
        "statusReason" = NULL,
        "voidedSalesInvoiceId" = NULL,
        "updatedBy" = ${userId},
        "updatedAt" = NOW()
    FROM (VALUES ${sql.join(
      stamps.map((stamp) => sql`(${stamp.billableItemId}, ${stamp.lineId})`)
    )}) AS v("id", "lineId")
    WHERE b."id" = v."id" AND b."companyId" = ${companyId}
  `.execute(trx);

  return {
    invoiceId,
    customerContractId: contract.id,
    mode,
    holdReason
  };
}

export const createProjectBillingInvoicesInput = z.object({
  /** `YYYY-MM-DD` in the company's timezone. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Draft one contract only. */
  customerContractId: z.string().optional()
});

/** Drafts the project billing invoices due on `asOf` (see
 *  `createProjectBillingInvoicesForContracts`). A contract that fails is
 *  reported in `failures`, never thrown, so the others still draft. */
const createProjectBillingInvoices = defineServerFn({
  name: "create-project-billing-invoices",
  input: createProjectBillingInvoicesInput,
  permissions: { update: "sales", create: "invoicing" },
  async run({ db, companyId, userId }, { asOf, customerContractId }) {
    return createProjectBillingInvoicesForContracts(db, {
      companyId,
      userId,
      asOf,
      customerContractId
    });
  }
});

export default createProjectBillingInvoices;
