// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { classifyAccountingPostingRole, datetime } from "@carbon/utils";
import { JournalEntrySyncError } from "./posting";
import type { Accounting } from "./types";

/** The posting roles whose original revenue account an AR document replays. */
type RevenueRole = "ShippingRevenue" | "SalesRevenue" | "ServiceRevenue";

const REVENUE_ROLES: ReadonlySet<string> = new Set<RevenueRole>([
  "ShippingRevenue",
  "SalesRevenue",
  "ServiceRevenue"
]);

const isRevenueRole = (role: string | null): role is RevenueRole =>
  role !== null && REVENUE_ROLES.has(role);

/** A service accrual row an invoice cleared, with the account it credited. */
type ServiceAccrualAccountRow = {
  invoiceId: string;
  accountId: string | null;
  accountClass: string | null;
  isGroup: boolean | null;
};

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
      "salesInvoiceLine.discountPercent",
      "salesInvoiceLine.shippingCost",
      "salesInvoiceLine.addOnCost",
      "salesInvoiceLine.nonTaxableAddOnCost",
      "salesInvoiceLine.taxPercent",
      "salesInvoiceLine.serviceJobId",
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
  // When the job's accrual covers every service line, the journal has no
  // "Service Revenue" line at all: each line credited Contract Assets in
  // full. The accrual rows that invoice cleared are stamped with one of its
  // service lines, and their credit account is the Service Revenue account
  // the run recognized the revenue to. Replay that account. It is a posted
  // fact as well, never today's default.
  const invoicesWithServiceRevenuePosting = new Set(
    postingRows
      .filter(
        (row) =>
          row.documentId &&
          classifyAccountingPostingRole(row.description) === "ServiceRevenue"
      )
      .map((row) => row.documentId as string)
  );
  const serviceLineInvoiceIds = new Map<string, string>();
  for (const line of lineRows) {
    if (
      line.serviceJobId &&
      !invoicesWithServiceRevenuePosting.has(line.invoiceId)
    ) {
      serviceLineInvoiceIds.set(line.id, line.invoiceId);
    }
  }
  const serviceAccrualRows: ServiceAccrualAccountRow[] = [];
  if (serviceLineInvoiceIds.size > 0) {
    const accrualRows = await db
      .selectFrom("revenueRecognitionSchedule")
      .innerJoin(
        "company",
        "company.id",
        "revenueRecognitionSchedule.companyId"
      )
      .leftJoin("account", (join) =>
        join
          .onRef(
            "account.id",
            "=",
            "revenueRecognitionSchedule.creditAccountId"
          )
          .onRef("account.companyGroupId", "=", "company.companyGroupId")
      )
      .select([
        "revenueRecognitionSchedule.billedBySalesInvoiceLineId",
        "revenueRecognitionSchedule.creditAccountId as accountId",
        "account.class as accountClass",
        "account.isGroup"
      ])
      .where("revenueRecognitionSchedule.companyId", "=", companyId)
      .where("revenueRecognitionSchedule.type", "=", "Accrual")
      .where("revenueRecognitionSchedule.serviceJobId", "is not", null)
      .where("revenueRecognitionSchedule.billedBySalesInvoiceLineId", "in", [
        ...serviceLineInvoiceIds.keys()
      ])
      .execute();
    for (const row of accrualRows) {
      const invoiceId = row.billedBySalesInvoiceLineId
        ? serviceLineInvoiceIds.get(row.billedBySalesInvoiceLineId)
        : undefined;
      if (!invoiceId) continue;
      serviceAccrualRows.push({
        invoiceId,
        accountId: row.accountId,
        accountClass: row.accountClass,
        isGroup: row.isGroup
      });
    }
  }

  const replayed = resolveReplayedRevenueAccounts(
    postingRows,
    serviceAccrualRows
  );

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
      shippingRevenueAccountId: replayed("ShippingRevenue", row.id),
      salesRevenueAccountId: replayed("SalesRevenue", row.id),
      serviceRevenueAccountId: replayed("ServiceRevenue", row.id),
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
        const discountPercent = Number(line.discountPercent) || 0;
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
          discountPercent,
          taxPercent,
          lineAmount: quantity * unitPrice * (1 - discountPercent),
          serviceJobId: line.serviceJobId ?? null
        };
      }),
      updatedAt: row.updatedAt ?? datetime.timestamp(),
      raw: row
    });
  }

  return result;
}

/**
 * The original revenue account each invoice's posted journal names, per role,
 * from its "Sales Account" / "Shipping Revenue" / "Service Revenue" journal
 * lines, plus the service accrual rows an invoice with no "Service Revenue"
 * line cleared.
 */
export function resolveReplayedRevenueAccounts(
  postingRows: Array<{
    documentId: string | null;
    accountId: string | null;
    description: string | null;
    accountClass: string | null;
    isGroup: boolean | null;
  }>,
  serviceAccrualRows: ServiceAccrualAccountRow[] = []
): (role: RevenueRole, invoiceId: string) => string | null {
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
    SalesRevenue: new Map(),
    ServiceRevenue: new Map()
  };
  // Invoices whose posting for a role is unusable, whatever else it posted.
  const unusableRoles: Record<RevenueRole, Set<string>> = {
    ShippingRevenue: new Set(),
    SalesRevenue: new Set(),
    ServiceRevenue: new Set()
  };
  const recordAccount = (
    role: RevenueRole,
    invoiceId: string,
    account: {
      accountId: string | null;
      accountClass: string | null;
      isGroup: boolean | null;
    }
  ) => {
    if (
      !account.accountId ||
      account.accountClass !== "Revenue" ||
      account.isGroup
    ) {
      unusableRoles[role].add(invoiceId);
      return;
    }
    const byInvoice = revenueAccounts[role];
    const accounts = byInvoice.get(invoiceId) ?? new Set<string>();
    accounts.add(account.accountId);
    byInvoice.set(invoiceId, accounts);
  };

  // A service job line posts a "Contract Assets" leg for the share of the
  // job's accrued revenue it clears, and "Service Revenue" for the rest. The
  // Contract Assets leg is not revenue for sync: the run journals that
  // accrued it never sync, so the provider takes the whole line as revenue.
  // `classifyAccountingPostingRole` leaves it unclassified.
  for (const row of postingRows) {
    const role = classifyAccountingPostingRole(row.description);
    if (!isRevenueRole(role)) continue;
    // Unreachable in practice — the query filters `documentId in ids`, so the
    // column is only nullable in the generated type — but a row that names no
    // invoice cannot be recorded against one either, and the alternative here
    // is a batch-wide throw.
    if (!row.documentId) continue;
    recordAccount(role, row.documentId, row);
  }

  // An invoice whose journal has no "Service Revenue" line replays the credit
  // account of the service accrual rows it cleared (see `loadSalesInvoices`,
  // which loads them only for such invoices).
  for (const row of serviceAccrualRows) {
    recordAccount("ServiceRevenue", row.invoiceId, row);
  }

  /**
   * The one account a role replays, or `null` when the journal cannot name it.
   *
   * Ambiguity is never resolved by guessing — Carbon posts ALL merchandise
   * revenue to one account (`accountDefault.salesAccount`; there is no
   * per-item revenue account in the schema), all service job revenue to one
   * (`accountDefault.serviceRevenueAccount`, else the sales account) and all
   * shipping revenue to another, so two of any means the journal is not the
   * shape this replay assumes. A role with ANY unusable posting stays unresolved even when a
   * second line did name a valid leaf, for the same reason.
   */
  return (role: RevenueRole, invoiceId: string): string | null => {
    if (unusableRoles[role].has(invoiceId)) return null;
    const ids = [...(revenueAccounts[role].get(invoiceId) ?? [])];
    return ids.length === 1 ? ids[0]! : null;
  };
}

/**
 * Merchandise components must replay an original account, never today's default.
 *
 * This is also where an UNRESOLVABLE original account is reported, not just an
 * absent one — the loader leaves every defect as `null` so the refusal lands on
 * the one invoice it belongs to (see `resolveReplayedRevenueAccounts`). The
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

/**
 * Service job components must replay an original account, never today's
 * default. The posting falls back to the Sales account when the Service
 * Revenue default is empty, and its line is still described "Service
 * Revenue", so the account read here is the one the journal credited.
 */
export function requirePostedServiceRevenueAccountId(
  invoice: Accounting.SalesInvoice
): string {
  if (!invoice.serviceRevenueAccountId)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync invoice: its posted journal does not name exactly one Service Revenue account — it is absent, posted to more than one account, or not a Revenue leaf account in the company group",
      metadata: { invoiceId: invoice.id }
    });
  return invoice.serviceRevenueAccountId;
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
