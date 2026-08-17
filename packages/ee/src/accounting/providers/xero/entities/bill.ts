import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import { loadAccountCodesById } from "../../../core/account-mapping";
import {
  type CostingLine,
  costingLineItemLabel,
  loadBillCostingLines,
  toTransactionCurrencyLines
} from "../../../core/document-costing";
import { createMappingService } from "../../../core/external-mapping";
import { JournalEntrySyncError, roundCurrency } from "../../../core/posting";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";

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
 * Build Xero ACCPAY line items as an account-costed replay of the bill's
 * posted "Purchase Invoice" journal: `AccountCode` = the journal line's
 * mapped account (GR-IR / PPV / clearing), NOT the item's account and NOT the
 * blunt `defaultPurchaseAccountCode`. Tax-neutral (`TaxType: "NONE"`, no
 * `TaxAmount`) — the purchase posting folds tax into cost, so the replay
 * amounts already embed it. Pure — exported for tests. Amounts are already in
 * the invoice's transaction currency (`toTransactionCurrencyLines`).
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
}): Xero.InvoiceLineItem[] {
  const { bill } = args;

  if (args.costingLines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync bill ${bill.invoiceId}: no posted Purchase Invoice journal found — the bill's G/L costing comes from its posting journal. Post the invoice (with accounting enabled), then retry.`,
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

  const nonTracked = args.nonTrackedItemIds;
  return args.costingLines.map((line) => {
    const attachItemCode =
      line.sourceItem && nonTracked?.has(line.sourceItem.id)
        ? line.sourceItem.code
        : null;
    return {
      Description: costingLineItemLabel(line) ?? line.description ?? undefined,
      LineAmount: roundCurrency(line.amount),
      AccountCode: args.accountCodesById.get(line.accountId!)!,
      TaxType: "NONE",
      ...(attachItemCode ? { ItemCode: attachItemCode.slice(0, 30) } : {})
    };
  });
}

export class BillSyncer extends BaseEntitySyncer<
  Accounting.Bill,
  Xero.Invoice,
  "UpdatedDateUTC"
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
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

  /** accountDefault.payablesAccount — the AP control line to exclude. */
  private async getPayablesAccountId(): Promise<string | null> {
    const defaults = await this.database
      .selectFrom("accountDefault")
      .select("payablesAccount")
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();
    return defaults?.payablesAccount ?? null;
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

    // Account-costed replay of the bill's posted Purchase Invoice journal.
    const payablesAccountId = await this.getPayablesAccountId();
    const accountCodesById = await this.getAccountCodesById();
    const {
      lines: costingLines,
      currencyCode,
      exchangeRate
    } = await loadBillCostingLines(this.database, {
      companyId: this.companyId,
      billId: local.id,
      payablesAccountId
    });

    const transactionLines = toTransactionCurrencyLines(
      costingLines,
      exchangeRate
    );

    const lineItems = buildXeroBillLineItems({
      bill: local,
      costingLines: transactionLines,
      accountCodesById,
      // v1: no item gets ItemCode on a bill line — proving a Xero item is
      // non-tracked needs a live per-item fetch (env-gated); attaching
      // ItemCode for a tracked item would double-post inventory. The
      // account-costed lines carry the item in Description instead.
      nonTrackedItemIds: undefined
    });

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
      // Pin the provider rate on FX bills (omit at parity rate 1).
      CurrencyRate: exchangeRate !== 1 ? exchangeRate : undefined,
      // Tax-neutral replay: lines embed tax; let Xero compute totals from the
      // NONE-taxed line amounts (no SubTotal/TotalTax/Total conflict).
      LineItems: lineItems
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Xero.Invoice
  ): Promise<Partial<Accounting.Bill>> {
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
      currencyCode: remote.CurrencyCode ?? "USD",
      exchangeRate: remote.CurrencyRate ?? 1,
      subtotal: remote.SubTotal ?? 0,
      totalTax: remote.TotalTax ?? 0,
      totalDiscount: 0,
      totalAmount: remote.Total ?? 0,
      balance: remote.AmountDue ?? 0,
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
        currencyCode: data.currencyCode ?? "USD",
        exchangeRate: data.exchangeRate ?? 1,
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
      .executeTakeFirstOrThrow();

    // Insert new lines
    for (const line of lines) {
      const itemId = line.itemCode
        ? (itemMap.get(line.itemCode) ?? null)
        : null;

      await tx
        .insertInto("purchaseInvoiceLine")
        .values({
          invoiceId,
          companyId: invoice.companyId,
          createdBy: invoice.createdBy,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          supplierUnitPrice: line.unitPrice,
          itemId,
          accountId: line.accountNumber
            ? (accountIdMap.get(line.accountNumber) ?? null)
            : null,
          taxPercent: line.taxPercent,
          taxAmount: line.taxAmount,
          supplierTaxAmount: line.taxAmount ?? 0,
          totalAmount: line.totalAmount,
          supplierExtendedPrice: line.totalAmount,
          exchangeRate: invoice.exchangeRate,
          invoiceLineType: itemId ? "Part" : "G/L Account",
          supplierShippingCost: 0
        })
        .execute();
    }
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
    }>("POST", "/Invoices", { body: JSON.stringify({ Invoices: invoices }) });

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
    }>("POST", "/Invoices", { body: JSON.stringify({ Invoices: invoices }) });

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
