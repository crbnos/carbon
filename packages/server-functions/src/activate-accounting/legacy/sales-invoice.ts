// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy sales invoice: the lines `post-sales-invoice`
// writes today, from the stored invoice, with today's account defaults
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a).
//
// It reads the stored facts and builds the journal with the posting's own
// builder (post-sales-invoice/posting-lines.ts): the same accounts, stand-ins,
// legs, COGS pair and dimensions. Two facts differ, and both are passed to
// the builder as choices:
// - Revenue. A contract, rental or fixed-asset line books plain revenue on
//   the sales account, so the backfill reads no contract, rental or asset
//   accounts. A line with Deferral schedule rows dated on or after the
//   cutover credits their sum to the rows' deferred revenue account, as the
//   posting deferred it; a recognition run (or the enable's rebuild of a
//   posted run) moves those rows to revenue. Rows dated before the cutover
//   were settled in the opening balance with no journal, so their share books
//   to sales.
// - Cost. The COGS pair of a direct line (no sales order, not Make to Order,
//   inventory-tracked) is at the cost its cost row stored, at zero too. A
//   legacy direct line stored no cost row; the enable writes it first
//   (movement-cost.ts), so its pair is built here, once. A line with no cost
//   row gets no pair.
// An invoice none of whose lines posts (`legacySalesInvoices`) is not found.
// Not rebuilt: the intercompany transaction record, schedule rows, contract
// movements and asset disposals. They are not journal lines, and the
// posting already wrote what it writes for every company.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { legacySalesInvoices } from "@carbon/database/legacy-documents";
import {
  allocateSalesHeaderShipping,
  round,
  type SalesPostingAccount
} from "@carbon/utils";
import { sql } from "kysely";
import {
  planSalesInvoiceAccounts,
  resolveSalesInvoiceAccounts
} from "../../post-sales-invoice/posting-accounts";
import {
  buildSalesInvoiceJournal,
  type SalesInvoiceLine,
  type SalesLineRevenue,
  salesLineDimensions
} from "../../post-sales-invoice/posting-lines";
import { type LegacyJournal, readByIds } from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

export async function buildLegacySalesInvoiceJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<LegacyJournal[]> {
  const invoices = await legacySalesInvoices(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (invoices.length === 0) return [];
  const invoiceIds = invoices.map((invoice) => invoice.id);

  const lines = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("salesInvoiceLine")
      .selectAll()
      .where("companyId", "=", companyId)
      .where("invoiceId", "in", ids)
      .orderBy("invoiceId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
  const lineIds = lines.map((line) => line.id);
  const itemIds = lines.map((line) => line.itemId);

  const shipments = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("salesInvoiceShipment")
      .select(["id", "shippingCost"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const customers = await readByIds(
    invoices.map((invoice) => invoice.customerId),
    (ids) =>
      trx
        .selectFrom("customer")
        .select(["id", "customerTypeId", "intercompanyCompanyId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const items = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const itemCosts = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "itemPostingGroupId"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  const salesOrderLines = await readByIds(
    lines.map((line) => line.salesOrderLineId),
    (ids) =>
      trx
        .selectFrom("salesOrderLine")
        .select(["id", "locationId", "sentComplete"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const assets = await readByIds(
    lines.map((line) => line.assetId),
    (ids) =>
      trx
        .selectFrom("fixedAsset")
        .select(["id", "locationId", "fixedAssetClassId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const agreementLines = await readByIds(
    lines.map((line) => line.rentalAgreementLineId),
    (ids) =>
      trx
        .selectFrom("rentalAgreementLine")
        .select(["id", "rentalAgreementId", "itemId", "lessorClassification"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  // What the posting deferred and a run has still to recognize: each line's
  // Deferral rows dated on or after the cutover, per deferred revenue account.
  const deferrals = await readByIds(lineIds, (ids) =>
    trx
      .selectFrom("revenueRecognitionSchedule")
      .select([
        "salesInvoiceLineId",
        "debitAccountId",
        sql<number>`sum("amount")`.as("amount")
      ])
      .where("companyId", "=", companyId)
      .where("salesInvoiceLineId", "in", ids)
      .where("type", "=", "Deferral")
      .where("scheduledDate", ">=", cutoverDate)
      .groupBy(["salesInvoiceLineId", "debitAccountId"])
      .orderBy("salesInvoiceLineId")
      .orderBy("debitAccountId")
      .execute()
  );
  // The cost a direct line's shipment relieved, where the posting stored it.
  const costRows = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("costLedger")
      .select(["id", "documentId", "itemId", "quantity", "cost"])
      .where("companyId", "=", companyId)
      .where("documentType", "=", "Sales Shipment")
      .where("documentId", "in", ids)
      .where("adjustment", "=", false)
      .where("quantity", "<", 0)
      .orderBy("entryNumber")
      .execute()
  );

  // The posting's accounts, with the stand-in rule of a posting before the
  // cutover: the enable writes these journals Provisional. Plain revenue
  // needs no deferral, rental or contract default; the deferral rows name
  // their own accounts.
  const plan = planSalesInvoiceAccounts(defaults, "Provisional", {
    deferredRevenue: false,
    rental: null,
    contract: false,
    accountIds: deferrals.map((row) => row.debitAccountId)
  });
  const accountRows = await readByIds(plan.accountIds, (ids) =>
    trx
      .selectFrom("account")
      .select(["id", "class", "active", "isGroup"])
      .where("companyGroupId", "=", companyGroupId)
      .where("id", "in", ids)
      .execute()
  );
  const accounts = resolveSalesInvoiceAccounts(
    plan,
    // Read by the company group, so it is the group's.
    accountRows.map((row): SalesPostingAccount => ({ ...row, companyGroupId })),
    companyGroupId
  );

  const linesByInvoice = Map.groupBy(lines, (line) => line.invoiceId);
  const shippingByInvoice = new Map(
    shipments.map((row) => [row.id, Number(row.shippingCost ?? 0)])
  );
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const deferralsByLine = Map.groupBy(
    deferrals,
    (row) => row.salesInvoiceLineId
  );
  const costRowsByInvoice = Map.groupBy(costRows, (row) => row.documentId);
  const facts = {
    companyId,
    companyGroupId,
    items: new Map(items.map((row) => [row.id, row])),
    postingGroups: new Map(
      itemCosts.map((row) => [row.itemId, row.itemPostingGroupId])
    ),
    salesOrderLines: new Map(salesOrderLines.map((row) => [row.id, row])),
    assets: new Map(assets.map((row) => [row.id, row])),
    rentalAgreementLines: new Map(agreementLines.map((row) => [row.id, row])),
    accounts,
    contract: null,
    rental: null,
    disposal: null
  };

  // A line with deferral rows credits them, and the rest to sales; every
  // other line books plain revenue.
  const revenue = (line: SalesInvoiceLine): SalesLineRevenue => {
    const deferred = deferralsByLine.get(line.id) ?? [];
    if (deferred.length === 0) return { book: "sales" };
    return {
      book: "legs",
      legs: [
        ...deferred.map((row) => ({
          account: accounts.account(row.debitAccountId),
          accountClass: "Liability" as const,
          description: "Deferred Revenue",
          amount: Number(row.amount)
        })),
        {
          account: accounts.account(defaults.salesAccount),
          accountClass: "Revenue" as const,
          description: "Sales Account"
        }
      ]
    };
  };

  return invoices.map((invoice) => {
    const customer = invoice.customerId
      ? customerById.get(invoice.customerId)
      : undefined;
    const invoiceLines = linesByInvoice.get(invoice.id) ?? [];
    const unusedCostRows = [...(costRowsByInvoice.get(invoice.id) ?? [])];
    // The cost row of a direct line: the first unused one of its item and
    // quantity, else of its item.
    const directCost = (line: SalesInvoiceLine): number | null => {
      if (!line.itemId) return null;
      const quantity = round(Number(line.quantity));
      const sameItem = unusedCostRows.filter(
        (row) => row.itemId === line.itemId
      );
      const costRow =
        sameItem.find((row) => round(-Number(row.quantity)) === quantity) ??
        sameItem[0];
      if (!costRow) return null;
      unusedCostRows.splice(unusedCostRows.indexOf(costRow), 1);
      return -Number(costRow.cost);
    };
    const journal = buildSalesInvoiceJournal({
      ...facts,
      invoice,
      customerTypeId: customer?.customerTypeId ?? null,
      intercompanyPartnerId: customer?.intercompanyCompanyId ?? null,
      lines: invoiceLines,
      headerShipping: allocateSalesHeaderShipping(
        invoiceLines,
        shippingByInvoice.get(invoice.id) ?? 0
      ),
      revenue,
      directCost
    });

    return {
      description: `Sales Invoice ${invoice.invoiceId}`,
      postingDate: String(invoice.postingDate),
      sourceType: "Sales Invoice" as const,
      lines: journal.lines.map((line, index) => ({
        ...accounts.standIns.storedLine(line),
        dimensions: salesLineDimensions(
          journal.metadata[index]!,
          invoice.customerId
        )
      }))
    };
  });
}
