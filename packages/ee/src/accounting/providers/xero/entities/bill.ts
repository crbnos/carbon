// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { KyselyTx } from "@carbon/database/client";
import {
  assertExchangeRate,
  distributeRoundingResidual,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { sql } from "kysely";
import { loadAccountCodesById } from "../../../core/account-mapping";
import {
  type CostingLine,
  costingLineItemLabel,
  loadBillCostingLines,
  splitBillTaxLegs,
  toTransactionCurrencyLines
} from "../../../core/document-costing";
import { createMappingService } from "../../../core/external-mapping";
import {
  JournalEntrySyncError,
  noPostedJournalMessage
} from "../../../core/posting";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";
import { assertXeroMoneyPrecision } from "../serialize";
import {
  hasXeroMappedTax,
  loadXeroTaxContext,
  resolveXeroTaxType,
  XERO_NO_TAX,
  type XeroTaxContext
} from "../tax";

// Note: This syncer uses the default ID mapping from BaseEntitySyncer
// which uses the externalIntegrationMapping table with entityType "bill"

// Type for rows returned from purchaseInvoice queries
type BillRow = {
  id: string;
  companyId: string;
  invoiceId: string;
  supplierId: string | null;
  status:
    | "Draft"
    | "Pending"
    | "Open"
    | "Return"
    | "Debit Note Issued"
    | "Paid"
    | "Partially Paid"
    | "Overdue"
    | "Voided";
  dateIssued: string | null;
  dateDue: string | null;
  datePaid: string | null;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalAmount: number;
  balance: number;
  supplierReference: string | null;
  updatedAt: string | null;
  customFields: Record<string, unknown> | null;
};

// Type for rows returned from purchaseInvoiceLine queries
type BillLineRow = {
  id: string;
  invoiceId: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  itemId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  itemCode: string | null;
  purchaseOrderLineId: string | null;
};

// Status mapping between Carbon and Xero
const CARBON_TO_XERO_STATUS: Record<BillRow["status"], Xero.Invoice["Status"]> =
  {
    Draft: "DRAFT",
    Pending: "SUBMITTED",
    Open: "AUTHORISED",
    Return: "DRAFT", // No direct equivalent, map to DRAFT
    "Debit Note Issued": "AUTHORISED",
    Paid: "PAID",
    "Partially Paid": "AUTHORISED", // Xero tracks partial payment via AmountDue
    Overdue: "AUTHORISED", // Xero doesn't have overdue status
    Voided: "VOIDED"
  };

const XERO_TO_CARBON_STATUS: Record<
  Xero.Invoice["Status"],
  Accounting.Bill["status"]
> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending",
  AUTHORISED: "Open",
  PAID: "Paid",
  VOIDED: "Voided",
  DELETED: "Voided"
};

// Only posted bills are pushed (Draft has no journal to replay).
const SYNCABLE_STATUSES: Accounting.Bill["status"][] = [
  "Pending",
  "Open",
  "Return",
  "Debit Note Issued",
  "Partially Paid",
  "Paid",
  "Overdue"
];

// Xero rejects line edits on a bill that already carries payments.
const PAID_STATUSES: Accounting.Bill["status"][] = ["Paid", "Partially Paid"];

/**
 * What a bill needs to send tax, for `buildXeroBillLineItems`: the tax
 * context, and the converted Tax Paid legs (`splitBillTaxLegs`) that the
 * provider books itself from each line's rate instead of as a line of its own.
 */
export type XeroBillTax = {
  /** Σ of the Tax Paid legs in the bill's currency; null when it has none. */
  recoverableTotal: number | null;
  decimalPlaces: number;
  context: XeroTaxContext;
};

/** A leg whose code is zero-rated or exempt on this line. */
function isZeroRatedLeg(line: CostingLine): boolean {
  return Boolean(line.tax?.taxCodeId) && line.tax?.taxPercent === 0;
}

/**
 * One cost leg split by recoverability (grill 10). A leg's amount L is the
 * net plus the non-recoverable tax, so its net is L / (1 + r·(1 − s)) for
 * rate r and recoverable share s. Xero takes one rate per line, so:
 * - `recoverableNet` (net × s) goes at the mapped purchase rate, carrying the
 *   recoverable tax `exactTax` (net × s × r, before rounding);
 * - the rest of L (the remaining net plus the non-recoverable tax) goes at
 *   `NONE` on the same account.
 * A leg with no recoverable tax has `exactTax` 0.
 */
type XeroBillLegSplit = {
  line: CostingLine;
  recoverableNet: number;
  exactTax: number;
};

function splitXeroBillLeg(
  line: CostingLine,
  decimalPlaces: number
): XeroBillLegSplit {
  const tax = line.tax;
  if (!tax || tax.taxPercent === 0 || tax.recoverableShare === 0) {
    return { line, recoverableNet: 0, exactTax: 0 };
  }
  const net = line.amount / (1 + tax.taxPercent * (1 - tax.recoverableShare));
  const recoverable = net * tax.recoverableShare;
  return {
    line,
    recoverableNet: round(recoverable, decimalPlaces),
    exactTax: recoverable * tax.taxPercent
  };
}

/**
 * Build Xero ACCPAY line items as an account-costed replay of the bill's
 * posted "Purchase Invoice" journal: `AccountCode` = the journal line's
 * mapped account (GR-IR / PPV / clearing), NOT the item's account and NOT the
 * blunt `defaultPurchaseAccountCode`. Pure — exported for tests. Amounts are
 * already in the invoice's transaction currency (`toTransactionCurrencyLines`).
 *
 * Without `tax` the lines are tax-neutral (`TaxType: "NONE"`, no
 * `TaxAmount`): the purchase posting folded all tax into cost, so the replay
 * amounts already embed it. With it, each leg goes out by its tax:
 * - recoverable tax: split by recoverability (`splitXeroBillLeg`), the
 *   recoverable part at the mapped purchase rate with its share of the Tax
 *   Paid legs, which `distributeRoundingResidual` makes sum to them exactly;
 * - a code at 0% (zero-rated or exempt): the code's mapped purchase rate with
 *   `TaxAmount` 0, so Xero counts the net on the return (box 7 in the UK);
 * - anything else (a non-zero rate with nothing recoverable, which the
 *   posting folded into cost, or no code at all): `NONE`, as before.
 * On a bill with recoverable tax (`tax.recoverableTotal` set), `costingLines`
 * exclude the Tax Paid legs, and a leg that cannot be tied to one tax code
 * refuses the bill rather than guess its share.
 *
 * `ItemCode` is attached ONLY for items known non-tracked (`nonTrackedItemIds`)
 * — a tracked Xero item would make Xero override the AccountCode with the
 * item's inventory account and double-post inventory.
 *
 * Unmapped / account-less / no-journal lines throw the structured
 * UNMAPPED_ACCOUNTS Warning (user-fixable: map the account, then retry).
 */
export function buildXeroBillLineItems(args: {
  bill: Accounting.Bill;
  costingLines: CostingLine[];
  accountCodesById: ReadonlyMap<string, string>;
  nonTrackedItemIds?: ReadonlySet<string>;
  /** Set when a leg carries tax Xero must see; absent keeps the tax-neutral replay. */
  tax?: XeroBillTax;
}): Xero.InvoiceLineItem[] {
  const { bill } = args;

  if (args.costingLines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: noPostedJournalMessage({
        subject: `bill ${bill.invoiceId}`,
        journal: "Purchase Invoice",
        document: "invoice"
      }),
      warning: true,
      metadata: { billId: bill.id }
    });
  }

  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];
  for (const line of args.costingLines) {
    if (!line.accountId) {
      lineIdsWithoutAccount.push(line.id);
      continue;
    }
    if (!args.accountCodesById.get(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }

  if (unmapped.size > 0 || lineIdsWithoutAccount.length > 0) {
    const parts: string[] = [];
    if (unmapped.size > 0) {
      parts.push(`${unmapped.size} account(s) have no Xero account mapping`);
    }
    if (lineIdsWithoutAccount.length > 0) {
      parts.push(
        `${lineIdsWithoutAccount.length} posting journal line(s) have no account`
      );
    }
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync bill ${bill.invoiceId}: ${parts.join(
        "; "
      )}. Map the account(s) on the integration settings page, then retry.`,
      warning: true,
      metadata: {
        billId: bill.id,
        unmappedAccountIds: [...unmapped],
        ...(lineIdsWithoutAccount.length > 0 ? { lineIdsWithoutAccount } : {})
      }
    });
  }

  assertXeroMoneyPrecision(...args.costingLines.map((line) => line.amount));
  const nonTracked = args.nonTrackedItemIds;
  const lineItem = (
    line: CostingLine,
    amount: number,
    tax: { TaxType: string; TaxAmount?: number }
  ): Xero.InvoiceLineItem => {
    const attachItemCode =
      line.sourceItem && nonTracked?.has(line.sourceItem.id)
        ? line.sourceItem.code
        : null;
    return {
      Description: costingLineItemLabel(line) ?? line.description ?? undefined,
      LineAmount: amount,
      AccountCode: args.accountCodesById.get(line.accountId!)!,
      ...tax,
      ...(attachItemCode ? { ItemCode: attachItemCode.slice(0, 30) } : {})
    };
  };

  const tax = args.tax;
  if (!tax) {
    return args.costingLines.map((line) =>
      lineItem(line, line.amount, { TaxType: XERO_NO_TAX })
    );
  }
  const { decimalPlaces, recoverableTotal } = tax;
  const mappedTaxType = (
    line: CostingLine,
    netAmount: number,
    taxAmount: number
  ) =>
    resolveXeroTaxType({
      context: tax.context,
      documentId: bill.id,
      direction: "purchase",
      taxCodeId: line.tax!.taxCodeId,
      taxPercent: line.tax!.taxPercent,
      netAmount,
      taxAmount,
      decimalPlaces
    });

  // The recoverable tax, spread over the legs that carry a share of it.
  const taxByLine = new Map<string, number>();
  const splits = args.costingLines.map((line) =>
    splitXeroBillLeg(line, decimalPlaces)
  );
  if (recoverableTotal !== null) {
    // A leg the posting could not tie to one invoice line's tax cannot be
    // split by recoverability. Refuse rather than guess its rate.
    const untied = args.costingLines.filter((line) => !line.tax);
    if (untied.length > 0) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_TAX_CODES",
        warning: true,
        message: `Cannot sync bill ${bill.invoiceId}: ${untied.length} posting journal line(s) cannot be tied to one tax code, so their recoverable tax cannot be sent to Xero.`,
        metadata: {
          billId: bill.id,
          journalLineIds: untied.map((line) => line.id)
        }
      });
    }
    const taxed = splits.filter((split) => split.exactTax !== 0);
    if (taxed.length === 0) {
      throw new Error(
        `Bill ${bill.invoiceId} has recoverable tax of ${recoverableTotal} but no line carries a recoverable share`
      );
    }
    const taxAmounts = distributeRoundingResidual(
      taxed.map((split) => split.exactTax),
      recoverableTotal,
      decimalPlaces
    );
    taxed.forEach((split, index) => {
      taxByLine.set(split.line.id, taxAmounts[index]!);
    });
  }

  return splits.flatMap((split) => {
    const { line, recoverableNet } = split;
    const taxAmount = taxByLine.get(line.id);
    if (taxAmount !== undefined) {
      const rest = round(line.amount - recoverableNet, decimalPlaces);
      return [
        lineItem(line, recoverableNet, {
          TaxType: mappedTaxType(line, recoverableNet, taxAmount),
          TaxAmount: taxAmount
        }),
        ...(rest !== 0 ? [lineItem(line, rest, { TaxType: XERO_NO_TAX })] : [])
      ];
    }
    if (isZeroRatedLeg(line)) {
      return [
        lineItem(line, line.amount, {
          TaxType: mappedTaxType(line, line.amount, 0),
          TaxAmount: 0
        })
      ];
    }
    return [lineItem(line, line.amount, { TaxType: XERO_NO_TAX })];
  });
}

/**
 * The bill's costing in its own currency, and the tax Xero must see. A bill
 * with no Tax Paid leg and no zero-rated coded leg replays every leg
 * tax-neutral, exactly as before the tax ledger existed, and never reads the
 * tax rates. One with Tax Paid legs drops them from the lines and carries
 * their converted total for the provider to book natively.
 */
export async function toXeroBillCosting(
  costing: {
    lines: CostingLine[];
    exchangeRate: number;
    documentTotal: number;
    decimalPlaces: number;
  },
  getContext: () => Promise<XeroTaxContext>
): Promise<{
  lines: CostingLine[];
  tax?: XeroBillTax;
}> {
  const { exchangeRate, documentTotal, decimalPlaces } = costing;
  const { lines, taxLegs } = splitBillTaxLegs(costing.lines);
  if (taxLegs.length === 0) {
    const converted = toTransactionCurrencyLines(costing.lines, {
      exchangeRate,
      documentTotal,
      decimalPlaces
    });
    if (!costing.lines.some(isZeroRatedLeg)) return { lines: converted };
    return {
      lines: converted,
      tax: {
        recoverableTotal: null,
        decimalPlaces,
        context: await getContext()
      }
    };
  }
  const converted = toTransactionCurrencyLines(lines, {
    exchangeRate,
    documentTotal,
    decimalPlaces,
    taxLegs
  });
  // The same per-leg conversion `toTransactionCurrencyLines` reconciles the
  // lines against, so lines + tax equal the document total exactly.
  const recoverableTotal = round(
    taxLegs.reduce(
      (sum, leg) =>
        sum + toDocumentAmount(leg.amount, exchangeRate, decimalPlaces),
      0
    ),
    decimalPlaces
  );
  return {
    lines: converted,
    tax: { recoverableTotal, decimalPlaces, context: await getContext() }
  };
}

export class BillSyncer extends BaseEntitySyncer<
  Accounting.Bill,
  Xero.Invoice,
  "UpdatedDateUTC"
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private taxContextPromise?: Promise<XeroTaxContext>;
  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  /** The tax-code mappings and Xero tax rates, loaded once per syncer. */
  private getTaxContext(): Promise<XeroTaxContext> {
    this.taxContextPromise ??= loadXeroTaxContext(
      this.database,
      { companyId: this.companyId, integration: this.provider.id },
      this.xeroProvider
    ).catch((error) => {
      this.taxContextPromise = undefined;
      throw error;
    });
    return this.taxContextPromise;
  }

  // =================================================================
  // 1. ID MAPPING - Uses default implementation from BaseEntitySyncer
  // The entityType "bill" maps to the purchaseInvoice table
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    // Use the mapping service to link bill -> purchaseInvoice
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link("bill", localId, this.provider.id, remoteId, {
      remoteUpdatedAt
    });
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.Invoice): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Bill | null> {
    const bills = await this.fetchBillsByIds([id]);
    return bills.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Bill>> {
    if (ids.length === 0) return new Map();
    return this.fetchBillsByIds(ids);
  }

  private async fetchBillsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Bill>> {
    if (ids.length === 0) return new Map();

    // Fetch bills
    const billRows = await this.database
      .selectFrom("purchaseInvoice")
      // `balance` is derived (totalAmount - posted payment applications) and
      // lives only on the `purchaseInvoices` view now, not the base table.
      .leftJoin("purchaseInvoices", "purchaseInvoices.id", "purchaseInvoice.id")
      .select([
        "purchaseInvoice.id",
        "purchaseInvoice.companyId",
        "purchaseInvoice.invoiceId",
        "purchaseInvoice.supplierId",
        "purchaseInvoice.status",
        "purchaseInvoice.dateIssued",
        "purchaseInvoice.dateDue",
        "purchaseInvoice.datePaid",
        "purchaseInvoice.currencyCode",
        "purchaseInvoice.exchangeRate",
        "purchaseInvoice.subtotal",
        "purchaseInvoice.totalTax",
        "purchaseInvoice.totalDiscount",
        "purchaseInvoice.totalAmount",
        "purchaseInvoices.balance",
        "purchaseInvoice.supplierReference",
        "purchaseInvoice.updatedAt",
        "purchaseInvoice.customFields"
      ])
      .where("purchaseInvoice.id", "in", ids)
      .where("purchaseInvoice.companyId", "=", this.companyId)
      .execute();

    if (billRows.length === 0) return new Map();

    // Fetch lines for all bills
    const billIds = billRows.map((b) => b.id);
    const lineRows = await this.database
      .selectFrom("purchaseInvoiceLine")
      .leftJoin("item", "item.id", "purchaseInvoiceLine.itemId")
      .leftJoin("account", "account.id", "purchaseInvoiceLine.accountId")
      .select([
        "purchaseInvoiceLine.id",
        "purchaseInvoiceLine.invoiceId",
        "purchaseInvoiceLine.description",
        "purchaseInvoiceLine.quantity",
        "purchaseInvoiceLine.unitPrice",
        "purchaseInvoiceLine.itemId",
        "purchaseInvoiceLine.taxPercent",
        "purchaseInvoiceLine.taxAmount",
        "purchaseInvoiceLine.totalAmount",
        "purchaseInvoiceLine.purchaseOrderLineId",
        "item.readableId as itemCode",
        "account.number as accountNumber"
      ])
      .where("purchaseInvoiceLine.invoiceId", "in", billIds)
      .execute();

    // Fetch supplier external IDs for mapping via the mapping service
    const supplierIds = billRows
      .map((b) => b.supplierId)
      .filter((id): id is string => id !== null);

    const supplierExternalIds = new Map<string, string | null>();
    if (supplierIds.length > 0) {
      const mappingService = createMappingService(
        this.database,
        this.companyId
      );
      for (const supplierId of supplierIds) {
        const externalId = await mappingService.getExternalId(
          "supplier",
          supplierId,
          this.provider.id
        );
        supplierExternalIds.set(supplierId, externalId);
      }
    }

    // Group lines by invoice
    const linesByInvoice = new Map<string, BillLineRow[]>();
    for (const line of lineRows) {
      const existing = linesByInvoice.get(line.invoiceId) ?? [];
      existing.push(line as BillLineRow);
      linesByInvoice.set(line.invoiceId, existing);
    }

    // Transform to Accounting.Bill
    const result = new Map<string, Accounting.Bill>();
    for (const row of billRows) {
      const lines = linesByInvoice.get(row.id) ?? [];
      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        invoiceId: row.invoiceId,
        supplierId: row.supplierId,
        supplierExternalId: row.supplierId
          ? (supplierExternalIds.get(row.supplierId) ?? null)
          : null,
        status: row.status,
        dateIssued: row.dateIssued,
        dateDue: row.dateDue,
        datePaid: row.datePaid,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        subtotal: Number(row.subtotal) || 0,
        totalTax: Number(row.totalTax) || 0,
        totalDiscount: Number(row.totalDiscount) || 0,
        totalAmount: Number(row.totalAmount) || 0,
        balance: Number(row.balance) || 0,
        supplierReference: row.supplierReference,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: Number(line.quantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          itemId: line.itemId,
          itemCode: line.itemCode,
          accountNumber: line.accountNumber,
          taxPercent: line.taxPercent != null ? Number(line.taxPercent) : null,
          taxAmount: line.taxAmount != null ? Number(line.taxAmount) : null,
          totalAmount: Number(line.totalAmount) || 0,
          purchaseOrderLineId: line.purchaseOrderLineId
        })),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.Invoice | null> {
    const result = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("GET", `/Invoices/${id}`);

    if (result.error) return null;

    const data = result.data as { Invoices: Xero.Invoice[] } | undefined;
    const invoice = data?.Invoices?.[0];

    // Only return if it's a Bill (ACCPAY)
    if (!invoice || invoice.Type !== "ACCPAY") {
      return null;
    }

    return invoice;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.Invoice>> {
    const result = new Map<string, Xero.Invoice>();
    if (ids.length === 0) return result;

    const response = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("GET", `/Invoices?IDs=${ids.join(",")}`);

    if (response.error) {
      throwXeroApiError("fetch bills batch", response);
    }

    const data = response.data as { Invoices: Xero.Invoice[] } | undefined;
    for (const invoice of data?.Invoices ?? []) {
      // Only include Bills (ACCPAY)
      if (invoice.Type === "ACCPAY") {
        result.set(invoice.InvoiceID, invoice);
      }
    }

    return result;
  }

  // =================================================================
  // SHOULD SYNC (posted-bill gate on push)
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.Bill, Xero.Invoice>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Bill must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero) — account-costed journal replay
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Bill
  ): Promise<Omit<Xero.Invoice, "UpdatedDateUTC">> {
    const existingRemoteId = await this.getRemoteId(local.id);

    // Paid-doc guard: Xero rejects line-item edits to a bill that already
    // carries payments — surface a Warning instead of pushing a line rewrite
    // (forward-only; the operator voids/unapplies the payment to re-push).
    if (existingRemoteId && PAID_STATUSES.includes(local.status)) {
      throw new JournalEntrySyncError({
        errorCode: "DOC_HAS_PAYMENTS",
        message: `Cannot re-push bill ${local.invoiceId} to Xero: it is ${local.status} and Xero rejects edits to a bill with payments. Void/unapply the payment in Xero, then retry (or leave it — the original push already reflects Carbon's journal).`,
        warning: true,
        metadata: { billId: local.id, status: local.status }
      });
    }

    // Account-costed replay of the bill's posted Purchase Invoice journal.
    const accountCodesById = await this.getAccountCodesById();
    const {
      lines: costingLines,
      currencyCode,
      exchangeRate,
      documentTotal,
      decimalPlaces,
      baseCurrencyCode
    } = await loadBillCostingLines(this.database, {
      companyId: this.companyId,
      billId: local.id
    });

    const { lines: transactionLines, tax } = await toXeroBillCosting(
      { lines: costingLines, exchangeRate, documentTotal, decimalPlaces },
      () => this.getTaxContext()
    );

    // Every tax resolves here, before the supplier dependency is written.
    const lineItems = buildXeroBillLineItems({
      bill: local,
      costingLines: transactionLines,
      accountCodesById,
      tax,
      // v1: no item gets ItemCode on a bill line — proving a Xero item is
      // non-tracked needs a live per-item fetch (env-gated); attaching
      // ItemCode for a tracked item would double-post inventory. The
      // account-costed lines carry the item in Description instead.
      nonTrackedItemIds: undefined
    });

    // Get supplier's Xero ContactID - ensure supplier is synced first
    let contactId = local.supplierExternalId;
    if (!contactId && local.supplierId) {
      contactId = await this.ensureDependencySynced("vendor", local.supplierId);
    }

    if (!contactId) {
      throw new Error(
        `Cannot sync bill ${local.id}: No supplier linked or supplier not synced to Xero`
      );
    }

    // Calculate due date: use dateDue if provided, otherwise default to Net 30
    let dueDate = local.dateDue;
    if (!dueDate && local.dateIssued) {
      const issued = new Date(local.dateIssued);
      issued.setDate(issued.getDate() + 30);
      dueDate = issued.toISOString().split("T")[0]; // YYYY-MM-DD format
    } else if (!dueDate) {
      // If no dateIssued either, default to 30 days from now
      const now = new Date();
      now.setDate(now.getDate() + 30);
      dueDate = now.toISOString().split("T")[0];
    }

    return {
      InvoiceID: existingRemoteId!,
      Type: "ACCPAY",
      InvoiceNumber: local.invoiceId,
      Reference: local.supplierReference ?? undefined,
      Contact: { ContactID: contactId },
      Date: local.dateIssued ?? undefined,
      DueDate: dueDate,
      Status: CARBON_TO_XERO_STATUS[local.status],
      CurrencyCode: currencyCode,
      // Pin every foreign snapshot, including negotiated 1:1 rates.
      CurrencyRate:
        currencyCode !== baseCurrencyCode ? exchangeRate : undefined,
      // Xero computes the totals from the lines (no SubTotal/TotalTax/Total
      // conflict). Lines with a mapped rate state amounts net of the tax they
      // carry; a tax-neutral replay sends no line tax and no LineAmountTypes.
      ...(hasXeroMappedTax(lineItems)
        ? { LineAmountTypes: "Exclusive" as const }
        : {}),
      LineItems: lineItems
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Xero.Invoice
  ): Promise<Partial<Accounting.Bill>> {
    const company = await this.database
      .selectFrom("company")
      .select("baseCurrencyCode")
      .where("id", "=", this.companyId)
      .executeTakeFirst();
    const currencyCode = remote.CurrencyCode ?? company?.baseCurrencyCode;
    if (!currencyCode || !company?.baseCurrencyCode)
      throw new Error("Xero bill currency metadata is required");
    const exchangeRate =
      remote.CurrencyRate ??
      (currencyCode === company.baseCurrencyCode ? 1 : null);
    if (exchangeRate === null)
      throw new Error("Xero foreign bill exchange rate is required");
    assertExchangeRate(exchangeRate);
    if (currencyCode === company.baseCurrencyCode && exchangeRate !== 1)
      throw new Error("Base-currency bill requires identity exchange rate");

    // Determine Carbon status based on Xero status and amounts
    let status = XERO_TO_CARBON_STATUS[remote.Status];

    // Check for partial payment
    if (
      remote.Status === "AUTHORISED" &&
      remote.AmountPaid &&
      remote.AmountPaid > 0 &&
      remote.AmountDue &&
      remote.AmountDue > 0
    ) {
      status = "Partially Paid";
    }

    // Check for overdue (would need to compare DueDate with current date)
    if (
      remote.Status === "AUTHORISED" &&
      remote.DueDate &&
      new Date(remote.DueDate) < new Date()
    ) {
      status = "Overdue";
    }

    // Map line items
    const lines: Accounting.BillLine[] = (remote.LineItems ?? []).map(
      (line, index) => {
        // Extract [ref:<id>] from description if present
        const refMatch = line.Description?.match(/\s*\[ref:([^\]]+)\]$/);
        const purchaseOrderLineId = refMatch?.[1] ?? null;
        const description =
          line.Description?.replace(/\s*\[ref:[^\]]+\]$/, "") ?? null;

        return {
          id: line.LineItemID ?? `temp-${index}`,
          description,
          quantity: line.Quantity ?? 1,
          unitPrice: line.UnitAmount ?? 0,
          itemId: null, // Will be resolved during upsertLocal if ItemCode matches
          itemCode: line.ItemCode ?? null,
          accountNumber: line.AccountCode ?? null,
          taxPercent: null,
          taxAmount: line.TaxAmount ?? null,
          totalAmount: line.LineAmount ?? 0,
          purchaseOrderLineId
        };
      }
    );

    return {
      invoiceId: remote.InvoiceNumber ?? remote.InvoiceID,
      supplierExternalId: remote.Contact.ContactID,
      status,
      dateIssued: remote.Date ?? null,
      dateDue: remote.DueDate ?? null,
      datePaid: remote.Status === "PAID" ? new Date().toISOString() : null,
      currencyCode,
      exchangeRate,
      subtotal: toBaseAmount(remote.SubTotal ?? 0, exchangeRate),
      totalTax: toBaseAmount(remote.TotalTax ?? 0, exchangeRate),
      totalDiscount: 0,
      totalAmount: toBaseAmount(remote.Total ?? 0, exchangeRate),
      balance: toBaseAmount(remote.AmountDue ?? 0, exchangeRate),
      supplierReference: remote.Reference ?? null,
      lines,
      updatedAt: remote.UpdatedDateUTC
        ? parseDotnetDate(remote.UpdatedDateUTC).toISOString()
        : new Date().toISOString()
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Bill>,
    remoteId: string
  ): Promise<string> {
    if (!data.currencyCode || data.exchangeRate == null)
      throw new Error(
        "Bill currency and exchange rate are required before storing supplier amounts"
      );
    assertExchangeRate(data.exchangeRate);
    const existingLocalId = await this.getLocalId(remoteId);

    // Resolve supplier from Xero ContactID using mapping service
    let supplierId: string | null = null;
    if (data.supplierExternalId) {
      const txMappingService = createMappingService(tx, this.companyId);
      supplierId = await txMappingService.getEntityId(
        this.provider.id,
        data.supplierExternalId,
        "supplier"
      );
    }

    if (existingLocalId) {
      // Update existing purchase invoice (mapping is handled by linkEntities in base class)
      await tx
        .updateTable("purchaseInvoice")
        .set({
          supplierId,
          status: data.status,
          dateIssued: data.dateIssued,
          dateDue: data.dateDue,
          datePaid: data.datePaid,
          currencyCode: data.currencyCode,
          exchangeRate: data.exchangeRate,
          subtotal: data.subtotal,
          totalTax: data.totalTax,
          totalDiscount: data.totalDiscount,
          totalAmount: data.totalAmount,
          supplierReference: data.supplierReference,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingLocalId)
        .where("companyId", "=", this.companyId)
        .execute();

      // Update lines - delete existing and recreate
      await this.upsertLines(tx, existingLocalId, data.lines ?? []);

      return existingLocalId;
    }

    // Create new purchase invoice from Xero
    // This requires: supplierInteractionId, invoiceId (sequence), createdBy, companyId

    if (!supplierId) {
      throw new Error(
        `Cannot create purchase invoice from Xero: Supplier with Xero ContactID ${data.supplierExternalId} not found in Carbon. Sync the vendor first.`
      );
    }

    // Get a default user for createdBy (company owner or first admin)
    const defaultUser = await this.getDefaultUser(tx);
    if (!defaultUser) {
      throw new Error(
        `Cannot create purchase invoice from Xero: No default user found for company ${this.companyId}`
      );
    }

    // Create supplier interaction for this invoice
    const supplierInteraction = await tx
      .insertInto("supplierInteraction")
      .values({
        companyId: this.companyId,
        supplierId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Get next invoice ID from sequence
    const sequenceResult = await sql<{ get_next_sequence: string }>`
      SELECT get_next_sequence('purchaseInvoice', ${this.companyId}) as get_next_sequence
    `.execute(tx);

    const invoiceId =
      sequenceResult.rows[0]?.get_next_sequence ??
      data.invoiceId ??
      `XERO-${remoteId.slice(0, 8)}`;

    // Insert the new purchase invoice
    const newInvoice = await tx
      .insertInto("purchaseInvoice")
      .values({
        invoiceId,
        companyId: this.companyId,
        createdBy: defaultUser,
        supplierId,
        supplierInteractionId: supplierInteraction.id,
        status: data.status ?? "Draft",
        dateIssued: data.dateIssued ?? null,
        dateDue: data.dateDue ?? null,
        datePaid: data.datePaid ?? null,
        currencyCode: data.currencyCode,
        exchangeRate: data.exchangeRate,
        subtotal: data.subtotal ?? 0,
        totalTax: data.totalTax ?? 0,
        totalDiscount: data.totalDiscount ?? 0,
        totalAmount: data.totalAmount ?? 0,
        supplierReference: data.supplierReference ?? null
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Insert lines for the new invoice
    await this.upsertLines(tx, newInvoice.id, data.lines ?? []);

    return newInvoice.id;
  }

  /**
   * Get a default user for system-generated records.
   * Tries company owner first, then falls back to first active employee.
   */
  private async getDefaultUser(tx: KyselyTx): Promise<string | null> {
    // Try company group owner first
    const group = await tx
      .selectFrom("company")
      .innerJoin("companyGroup", "companyGroup.id", "company.companyGroupId")
      .select("companyGroup.ownerId")
      .where("company.id", "=", this.companyId)
      .executeTakeFirst();

    if (group?.ownerId) {
      return group.ownerId;
    }

    // Fall back to first active employee for this company (by user creation date)
    const employee = await tx
      .selectFrom("employeeJob")
      .innerJoin("user", "user.id", "employeeJob.id")
      .select("employeeJob.id")
      .where("employeeJob.companyId", "=", this.companyId)
      .where("user.active", "=", true)
      .orderBy("user.createdAt", "asc")
      .limit(1)
      .executeTakeFirst();

    return employee?.id ?? null;
  }

  private async upsertLines(
    tx: KyselyTx,
    invoiceId: string,
    lines: Accounting.BillLine[]
  ): Promise<void> {
    // Delete existing lines
    await tx
      .deleteFrom("purchaseInvoiceLine")
      .where("invoiceId", "=", invoiceId)
      .where("companyId", "=", this.companyId)
      .execute();

    if (lines.length === 0) return;

    // Resolve item IDs from item codes
    const itemCodes = lines
      .map((l) => l.itemCode)
      .filter((code): code is string => code !== null);

    const itemMap = new Map<string, string>();
    if (itemCodes.length > 0) {
      const items = await tx
        .selectFrom("item")
        .select(["id", "readableId"])
        .where("readableId", "in", itemCodes)
        .where("companyId", "=", this.companyId)
        .execute();

      for (const item of items) {
        itemMap.set(item.readableId, item.id);
      }
    }

    // Resolve account IDs from Xero AccountCodes
    const accountNumbers = [
      ...new Set(
        lines.map((l) => l.accountNumber).filter((n): n is string => n !== null)
      )
    ];
    const accountIdMap = new Map<string, string>();
    if (accountNumbers.length > 0) {
      const companyGroupId = await this.getCompanyGroupId(tx);
      if (companyGroupId) {
        const accounts = await tx
          .selectFrom("account")
          .select(["id", "number"])
          .where("companyGroupId", "=", companyGroupId)
          .where("number", "in", accountNumbers)
          .where("active", "=", true)
          .execute();
        for (const a of accounts) {
          if (a.number) accountIdMap.set(a.number, a.id);
        }
      }
    }

    // Get the invoice to get companyId and createdBy
    const invoice = await tx
      .selectFrom("purchaseInvoice")
      .select(["companyId", "createdBy", "exchangeRate"])
      .where("id", "=", invoiceId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirstOrThrow();

    const rows = lines.map((line) => {
      const itemId = line.itemCode
        ? (itemMap.get(line.itemCode) ?? null)
        : null;

      return {
        invoiceId,
        companyId: invoice.companyId,
        createdBy: invoice.createdBy,
        description: line.description,
        quantity: line.quantity,
        supplierUnitPrice: line.unitPrice,
        itemId,
        accountId: line.accountNumber
          ? (accountIdMap.get(line.accountNumber) ?? null)
          : null,
        taxPercent: line.taxPercent,
        supplierTaxAmount: line.taxAmount ?? 0,
        exchangeRate: invoice.exchangeRate,
        invoiceLineType: itemId ? ("Part" as const) : ("G/L Account" as const),
        supplierShippingCost: 0
      };
    });
    await tx.insertInto("purchaseInvoiceLine").values(rows).execute();
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.Invoice, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);
    const invoices = existingRemoteId
      ? [{ ...data, InvoiceID: existingRemoteId }]
      : [data];

    const result = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("POST", "/Invoices?unitdp=4", {
      body: JSON.stringify({ Invoices: invoices })
    });

    if (result.error) {
      throwXeroApiError(
        existingRemoteId ? "update bill" : "create bill",
        result
      );
    }

    if (!result.data?.Invoices?.[0]?.InvoiceID) {
      throw new Error(
        "Xero API returned success but no InvoiceID was returned for bill"
      );
    }

    return result.data.Invoices[0].InvoiceID;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.Invoice, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (data.length === 0) return result;

    const invoices: Xero.Invoice[] = [];
    const localIdOrder: string[] = [];

    for (const { localId, payload } of data) {
      const existingRemoteId = await this.getRemoteId(localId);
      invoices.push(
        existingRemoteId
          ? ({ ...payload, InvoiceID: existingRemoteId } as Xero.Invoice)
          : (payload as Xero.Invoice)
      );
      localIdOrder.push(localId);
    }

    const response = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("POST", "/Invoices?unitdp=4", {
      body: JSON.stringify({ Invoices: invoices })
    });

    if (response.error) {
      throwXeroApiError("batch upsert bills", response);
    }

    if (!response.data?.Invoices) {
      throw new Error(
        "Xero API returned success but no Invoices array was returned for bills"
      );
    }

    for (let i = 0; i < response.data.Invoices.length; i++) {
      const returnedInvoice = response.data.Invoices[i];
      const localId = localIdOrder[i];
      if (returnedInvoice?.InvoiceID && localId) {
        result.set(localId, returnedInvoice.InvoiceID);
      }
    }

    return result;
  }
}
