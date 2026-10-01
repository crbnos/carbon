// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { datetime } from "@carbon/database/datetime";
import { classifyAccountingPostingRole } from "@carbon/utils";
import { JournalEntrySyncError } from "./posting";
import type { Accounting } from "./types";

/** The posting roles whose original revenue account an AR document replays. */
type RevenueRole = "ShippingRevenue" | "SalesRevenue";

/** One provider-neutral source boundary for invoice amounts and original posting facts. */
export async function loadSalesInvoices(
  db: Kysely<KyselyDatabase> | KyselyTx,
  { companyId, ids }: { companyId: string; ids: string[] }
): Promise<Map<string, Accounting.SalesInvoice>> {
  if (ids.length === 0) return new Map();

  // Fetch invoice headers
  const invoiceRows = await db
    .selectFrom("salesInvoice")
    // `balance` is derived (totalAmount - posted payment applications) and
    // lives only on the `salesInvoices` view now, not the base table.
    .leftJoin("salesInvoices", (join) =>
      join
        .onRef("salesInvoices.id", "=", "salesInvoice.id")
        .onRef("salesInvoices.companyId", "=", "salesInvoice.companyId")
    )
    .innerJoin("company", "company.id", "salesInvoice.companyId")
    .leftJoin("salesInvoiceShipment", (join) =>
      join
        .onRef("salesInvoiceShipment.id", "=", "salesInvoice.id")
        .onRef("salesInvoiceShipment.companyId", "=", "salesInvoice.companyId")
    )
    .leftJoin("currency as documentCurrency", (join) =>
      join
        .onRef("documentCurrency.code", "=", "salesInvoice.currencyCode")
        .onRef("documentCurrency.companyGroupId", "=", "company.companyGroupId")
    )
    .leftJoin("currency as baseCurrency", (join) =>
      join
        .onRef("baseCurrency.code", "=", "company.baseCurrencyCode")
        .onRef("baseCurrency.companyGroupId", "=", "company.companyGroupId")
    )
    .select([
      "salesInvoice.id",
      "salesInvoice.invoiceId",
      "salesInvoice.companyId",
      "salesInvoice.customerId",
      "salesInvoice.status",
      "salesInvoice.currencyCode",
      "salesInvoice.exchangeRate",
      "salesInvoice.postingDate",
      "salesInvoice.dateIssued",
      "salesInvoice.dateDue",
      "salesInvoice.datePaid",
      "salesInvoice.customerReference",
      "salesInvoices.subtotal",
      "salesInvoices.totalTax",
      "salesInvoice.totalDiscount",
      "salesInvoices.totalAmount",
      "salesInvoices.balance",
      "salesInvoiceShipment.shippingCost as headerShippingCost",
      "company.baseCurrencyCode",
      "baseCurrency.decimalPlaces as baseCurrencyDecimalPlaces",
      "documentCurrency.decimalPlaces as currencyDecimalPlaces",
      "salesInvoice.updatedAt"
    ])
    .where("salesInvoice.id", "in", ids)
    .where("salesInvoice.companyId", "=", companyId)
    .execute();

  if (invoiceRows.length === 0) return new Map();

  // Fetch invoice lines with item codes
  const lineRows = await db
    .selectFrom("salesInvoiceLine")
    .leftJoin("item", (join) =>
      join
        .onRef("item.id", "=", "salesInvoiceLine.itemId")
        .onRef("item.companyId", "=", "salesInvoiceLine.companyId")
    )
    .select([
      "salesInvoiceLine.id",
      "salesInvoiceLine.invoiceId",
      "salesInvoiceLine.invoiceLineType",
      "salesInvoiceLine.itemId",
      "salesInvoiceLine.description",
      "salesInvoiceLine.quantity",
      "salesInvoiceLine.unitPrice",
      "salesInvoiceLine.convertedUnitPrice",
      "salesInvoiceLine.shippingCost",
      "salesInvoiceLine.addOnCost",
      "salesInvoiceLine.nonTaxableAddOnCost",
      "salesInvoiceLine.taxPercent",
      "item.readableIdWithRevision as itemReadableIdWithRevision"
    ])
    .where("salesInvoiceLine.companyId", "=", companyId)
    .where(
      "salesInvoiceLine.invoiceId",
      "in",
      invoiceRows.map((r) => r.id)
    )
    .execute();

  const postingRows = await db
    .selectFrom("journalLine")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "journalLine.journalId")
        .onRef("journal.companyId", "=", "journalLine.companyId")
    )
    .innerJoin("company", "company.id", "journalLine.companyId")
    .leftJoin("account", (join) =>
      join
        .onRef("account.id", "=", "journalLine.accountId")
        .onRef("account.companyGroupId", "=", "company.companyGroupId")
    )
    .select([
      "journalLine.documentId",
      "journalLine.accountId",
      "journalLine.description",
      "account.class as accountClass",
      "account.isGroup"
    ])
    .where(
      "journalLine.documentId",
      "in",
      invoiceRows.map((row) => row.id)
    )
    .where("journalLine.documentType", "=", "Invoice")
    .where("journalLine.companyId", "=", companyId)
    .where("journal.companyId", "=", companyId)
    .where("journal.sourceType", "=", "Sales Invoice")
    .where("journal.status", "=", "Posted")
    .execute();
  // Both revenue roles are extracted the same way, and for the same reason: a
  // provider document must replay the account its ORIGINAL journal posted to,
  // never today's default. Merchandise revenue joined shipping here when AR
  // invoices stopped referencing items — the item used to carry the account
  // implicitly (via the provider item's own config), and with the item gone the
  // posted account is the only thing that can.
  //
  // Every defect below belongs to ONE invoice, and none of them throws from
  // here. This is a BATCH loader: `pushBatchToAccounting` calls it once for the
  // whole claimed group (up to 20 operations) and its outer catch parks every
  // id in that group as an error carrying whatever this function threw. So one
  // invoice with a malformed revenue posting used to park every other posted
  // invoice drained beside it — as a Warning naming a DIFFERENT document — and
  // nothing brings those back: `shouldEnqueueMissingDocument` refuses to
  // re-enqueue a parked Warning, the capped re-drive is `bill`-only, and the
  // changed-since-failure retry needs the document to be edited. Instead the
  // role's account is left unresolved (`null`) and
  // `requirePostedSalesAccountId` / `requirePostedShippingAccountId` raise the
  // structured error for that one invoice from inside `mapToRemote`, which
  // `pushBatchToAccounting` already catches per entity.
  const revenueAccounts: Record<RevenueRole, Map<string, Set<string>>> = {
    ShippingRevenue: new Map(),
    SalesRevenue: new Map()
  };
  // Invoices whose posting for a role is unusable, whatever else it posted.
  const unusableRoles: Record<RevenueRole, Set<string>> = {
    ShippingRevenue: new Set(),
    SalesRevenue: new Set()
  };

  for (const row of postingRows) {
    const role = classifyAccountingPostingRole(row.description);
    if (role !== "ShippingRevenue" && role !== "SalesRevenue") continue;
    // Unreachable in practice — the query filters `documentId in ids`, so the
    // column is only nullable in the generated type — but a row that names no
    // invoice cannot be recorded against one either, and the alternative here
    // is a batch-wide throw.
    if (!row.documentId) continue;
    if (!row.accountId || row.accountClass !== "Revenue" || row.isGroup) {
      unusableRoles[role].add(row.documentId);
      continue;
    }
    const byInvoice = revenueAccounts[role];
    const accounts = byInvoice.get(row.documentId) ?? new Set<string>();
    accounts.add(row.accountId);
    byInvoice.set(row.documentId, accounts);
  }

  /**
   * The one account a role replays, or `null` when the journal cannot name it.
   *
   * Ambiguity is never resolved by guessing — Carbon posts ALL merchandise
   * revenue to one account (`accountDefault.salesAccount`; there is no
   * per-item revenue account in the schema) and all shipping revenue to
   * another, so two of either means the journal is not the shape this replay
   * assumes. A role with ANY unusable posting stays unresolved even when a
   * second line did name a valid leaf, for the same reason.
   */
  const resolveReplayedAccountId = (role: RevenueRole, invoiceId: string) => {
    if (unusableRoles[role].has(invoiceId)) return null;
    const ids = [...(revenueAccounts[role].get(invoiceId) ?? [])];
    return ids.length === 1 ? ids[0]! : null;
  };

  // Group lines by invoice ID
  const linesByInvoiceId = new Map<string, (typeof lineRows)[number][]>();
  for (const line of lineRows) {
    const existing = linesByInvoiceId.get(line.invoiceId) ?? [];
    existing.push(line);
    linesByInvoiceId.set(line.invoiceId, existing);
  }

  // Transform to Accounting.SalesInvoice
  const result = new Map<string, Accounting.SalesInvoice>();
  for (const row of invoiceRows) {
    if (
      !row.baseCurrencyCode ||
      !row.currencyCode ||
      row.baseCurrencyDecimalPlaces == null ||
      row.currencyDecimalPlaces == null
    ) {
      throw new Error(
        `Invoice ${row.id} is missing authoritative currency precision metadata`
      );
    }
    if (
      row.subtotal == null ||
      row.totalTax == null ||
      row.totalAmount == null ||
      row.balance == null
    ) {
      throw new Error(
        `Invoice ${row.id} is missing authoritative source view totals`
      );
    }
    const lines = linesByInvoiceId.get(row.id) ?? [];

    result.set(row.id, {
      id: row.id,
      invoiceId: row.invoiceId,
      companyId: row.companyId,
      customerId: row.customerId,
      customerExternalId: null, // Will be resolved during mapToRemote
      status: row.status,
      currencyCode: row.currencyCode,
      baseCurrencyCode: row.baseCurrencyCode,
      baseCurrencyDecimalPlaces: Number(row.baseCurrencyDecimalPlaces),
      currencyDecimalPlaces: Number(row.currencyDecimalPlaces),
      shippingRevenueAccountId: resolveReplayedAccountId(
        "ShippingRevenue",
        row.id
      ),
      salesRevenueAccountId: resolveReplayedAccountId("SalesRevenue", row.id),
      headerShippingCost: Number(row.headerShippingCost ?? 0),
      exchangeRate: Number(row.exchangeRate),
      postingDate: row.postingDate,
      dateIssued: row.dateIssued,
      dateDue: row.dateDue,
      datePaid: row.datePaid,
      customerReference: row.customerReference,
      subtotal: Number(row.subtotal),
      totalTax: Number(row.totalTax),
      totalDiscount: Number(row.totalDiscount) || 0,
      totalAmount: Number(row.totalAmount),
      balance: Number(row.balance),
      lines: lines.map((line) => {
        const quantity = Number(line.quantity) || 0;
        const unitPrice = Number(line.unitPrice) || 0;
        const taxPercent = Number(line.taxPercent) || 0;
        const convertedUnitPrice =
          line.convertedUnitPrice === null ||
          line.convertedUnitPrice === undefined
            ? null
            : Number(line.convertedUnitPrice);
        return {
          id: line.id,
          invoiceLineType: line.invoiceLineType,
          itemId: line.itemId,
          itemCode: line.itemReadableIdWithRevision,
          description: line.description,
          quantity,
          unitPrice,
          shippingCost: Number(line.shippingCost ?? 0),
          addOnCost: Number(line.addOnCost ?? 0),
          nonTaxableAddOnCost: Number(line.nonTaxableAddOnCost ?? 0),
          convertedUnitPrice,
          taxPercent,
          lineAmount: quantity * unitPrice
        };
      }),
      updatedAt: row.updatedAt ?? datetime.timestamp(),
      raw: row
    });
  }

  return result;
}

/**
 * Merchandise components must replay an original account, never today's default.
 *
 * This is also where an UNRESOLVABLE original account is reported, not just an
 * absent one — the loader leaves every defect as `null` so the refusal lands on
 * the one invoice it belongs to (see the comment in `loadSalesInvoices`). The
 * message therefore names all three causes; the invoice id is what a reader
 * needs to open the journal and see which.
 */
export function requirePostedSalesAccountId(
  invoice: Accounting.SalesInvoice
): string {
  if (!invoice.salesRevenueAccountId)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync invoice: its posted journal does not name exactly one Sales Revenue account — it is absent, posted to more than one account, or not a Revenue leaf account in the company group",
      metadata: { invoiceId: invoice.id }
    });
  return invoice.salesRevenueAccountId;
}

/** Shipping components must replay an original account, never today's default. */
export function requirePostedShippingAccountId(
  invoice: Accounting.SalesInvoice
): string {
  if (!invoice.shippingRevenueAccountId)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync invoice: its posted journal does not name exactly one Shipping Revenue account — it is absent, posted to more than one account, or not a Revenue leaf account in the company group",
      metadata: { invoiceId: invoice.id }
    });
  return invoice.shippingRevenueAccountId;
}
