import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { datetime } from "@carbon/database/datetime";
import { classifyAccountingPostingRole } from "@carbon/utils";
import { JournalEntrySyncError } from "./posting";
import type { Accounting } from "./types";

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
  const shippingAccounts = new Map<string, Set<string>>();
  for (const row of postingRows) {
    if (classifyAccountingPostingRole(row.description) !== "ShippingRevenue")
      continue;
    if (
      !row.documentId ||
      !row.accountId ||
      row.accountClass !== "Revenue" ||
      row.isGroup
    ) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message:
          "Cannot sync invoice: original Shipping Revenue posting has no valid Revenue leaf account in the company group",
        metadata: { invoiceId: row.documentId, accountId: row.accountId }
      });
    }
    const accounts = shippingAccounts.get(row.documentId) ?? new Set<string>();
    accounts.add(row.accountId);
    shippingAccounts.set(row.documentId, accounts);
  }

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

    const shippingIds = [...(shippingAccounts.get(row.id) ?? [])];
    if (shippingIds.length > 1)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message:
          "Cannot sync invoice: original Shipping Revenue posting has multiple accounts",
        metadata: { invoiceId: row.id, accountIds: shippingIds }
      });
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
      shippingRevenueAccountId: shippingIds[0] ?? null,
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

/** Shipping components must replay an original account, never today's default. */
export function requirePostedShippingAccountId(
  invoice: Accounting.SalesInvoice
): string {
  if (!invoice.shippingRevenueAccountId)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync invoice: original Shipping Revenue account is missing from its posted journal",
      metadata: { invoiceId: invoice.id }
    });
  return invoice.shippingRevenueAccountId;
}
