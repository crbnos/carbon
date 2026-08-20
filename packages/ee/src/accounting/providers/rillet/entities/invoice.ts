import {
  JournalEntrySyncError,
  toPostingDateString
} from "../../../core/posting";
import type { Accounting, ShouldSyncContext } from "../../../core/types";
import type {
  Rillet,
  RilletInvoiceCreate,
  RilletTransactionWriteOmit
} from "../models";
import {
  buildRilletIdempotencyKey,
  isRilletUnknownExternalReferenceTypeError
} from "../provider";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  customerCustomExternalReference,
  RILLET_CARBON_COMPANY_REFERENCE_TYPE,
  RILLET_CARBON_REFERENCE_TYPE,
  RilletTransactionSyncer,
  toRilletMoney
} from "./shared";

/**
 * RilletSalesInvoiceSyncer — Carbon sales invoices → Rillet AR_ONLY
 * invoices (push-only, create-only; entityType "invoice").
 *
 * AR_ONLY is Rillet's external-ERP scope: Carbon keeps generating and
 * sending the invoice; Rillet carries the receivable (and reports
 * payments back through the invoice-payment-updated webhook → the payment
 * syncer). `invoice_number` is Carbon's readable invoice id.
 *
 * Customer and line items are JIT-synced via ensureDependencySynced
 * before the document. Rillet AR_ONLY items REQUIRE a product_id, so a
 * line without a Carbon item cannot be represented — it fails with a
 * structured Warning listing the lines (UNMAPPED_ACCOUNTS envelope: the
 * closest user-fixable code available; the core error-code list has no
 * missing-item code yet).
 *
 * Create-only: pushed invoices are never updated from Carbon in v1 —
 * RilletTransactionSyncer hard-skips already-mapped ids (updates are a
 * follow-up).
 */

// Only posted invoices are pushed (same status gate as the Xero/QBO
// sales-invoice syncers)
const SYNCABLE_STATUSES: Accounting.SalesInvoice["status"][] = [
  "Pending",
  "Submitted",
  "Partially Paid",
  "Paid",
  "Overdue"
];

// Row shapes for sales invoice queries (mirror the QBO syncer's)
type InvoiceRow = {
  id: string;
  invoiceId: string;
  companyId: string;
  customerId: string;
  status: Accounting.SalesInvoice["status"];
  currencyCode: string;
  exchangeRate: number;
  dateIssued: string | null;
  dateDue: string | null;
  datePaid: string | null;
  customerReference: string | null;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalAmount: number;
  balance: number;
  updatedAt: string | null;
};

type InvoiceLineRow = {
  id: string;
  invoiceId: string;
  invoiceLineType: string;
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  itemReadableIdWithRevision: string | null;
};

/**
 * Map a Carbon sales invoice to the Rillet AR_ONLY create payload. Pure —
 * exported for tests. `itemRemoteIds` maps Carbon itemId → Rillet product
 * id (resolved by ensureDependencySynced before mapping).
 *
 * Throws the structured UNMAPPED_ACCOUNTS Warning when any line has no
 * item (AR_ONLY items require product_id), and a plain Error when a
 * line's item was not resolved to a product (a dependency-sync bug, not
 * user-fixable).
 */
export function mapSalesInvoiceToRilletInvoice(args: {
  invoice: Accounting.SalesInvoice;
  customerRemoteId: string;
  itemRemoteIds: ReadonlyMap<string, string>;
  subsidiaryId: string | null;
  companyId: string;
  /** Link back to the Carbon invoice — REQUIRED by Rillet on
   * CUSTOMER_CUSTOM references. */
  documentUrl: string;
}): RilletInvoiceCreate {
  const { invoice } = args;
  const currency = invoice.currencyCode;

  const lineIdsWithoutItem = invoice.lines
    .filter((line) => !line.itemId)
    .map((line) => line.id);
  if (lineIdsWithoutItem.length > 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync invoice ${invoice.invoiceId}: ${lineIdsWithoutItem.length} line(s) have no item — Rillet AR_ONLY invoice lines require a product. Assign an item to the line(s), then retry.`,
      warning: true,
      metadata: { invoiceId: invoice.id, lineIdsWithoutItem }
    });
  }

  const items: Rillet.InvoiceItem[] = invoice.lines.map((line) => {
    const productId = args.itemRemoteIds.get(line.itemId!);
    if (!productId) {
      throw new Error(
        `Cannot sync invoice ${invoice.invoiceId}: item ${line.itemId} has not been synced to Rillet`
      );
    }

    return {
      product_id: productId,
      description: line.description ?? line.itemCode ?? "Invoice line",
      quantity: line.quantity,
      total_amount: toRilletMoney(line.quantity * line.unitPrice, currency),
      // CUSTOMER_CUSTOM satisfies rev-rec validation and carries the line id
      // for audit. NO `carbon` ref here: Rillet counts header + item
      // references together for RESTRICTED types, and organizations that
      // register `carbon` as restricted reject a document carrying it on
      // both the header and a line ("multiple references of a restricted
      // type" — verified on the sandbox 2026-08-12). The header's carbon
      // ref is the document's single origin link.
      external_references: [
        customerCustomExternalReference(line.id, args.documentUrl)
      ]
    };
  });

  const invoiceDate = toPostingDateString(
    invoice.dateIssued ?? new Date().toISOString()
  );

  return {
    scope: "AR_ONLY",
    customer_id: args.customerRemoteId,
    invoice_number: invoice.invoiceId,
    invoice_date: invoiceDate,
    // Rillet defaults due_date to invoice_date when omitted
    ...(invoice.dateDue
      ? { due_date: toPostingDateString(invoice.dateDue) }
      : {}),
    ...(invoice.totalTax > 0
      ? { tax_amount: toRilletMoney(invoice.totalTax, currency) }
      : {}),
    ...(args.subsidiaryId ? { subsidiary_id: args.subsidiaryId } : {}),
    items,
    // CUSTOMER_CUSTOM satisfies Rillet rev-rec validation (accepted integration
    // type); the carbon / carbon-company refs stay for origin auditing.
    external_references: [
      carbonExternalReference(invoice.id),
      carbonCompanyExternalReference(args.companyId),
      customerCustomExternalReference(invoice.id, args.documentUrl)
    ]
  };
}

export class RilletSalesInvoiceSyncer extends RilletTransactionSyncer<
  Accounting.SalesInvoice,
  Rillet.Invoice,
  RilletTransactionWriteOmit
> {
  protected get pushOnlyEntityLabel(): string {
    return "Sales invoices";
  }

  // =================================================================
  // 1. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.SalesInvoice | null> {
    const invoices = await this.fetchInvoicesByIds([id]);
    return invoices.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    return this.fetchInvoicesByIds(ids);
  }

  private async fetchInvoicesByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    if (ids.length === 0) return new Map();

    const invoiceRows = await this.database
      .selectFrom("salesInvoice")
      // `balance` is derived and lives only on the `salesInvoices` view
      .leftJoin("salesInvoices", "salesInvoices.id", "salesInvoice.id")
      .select([
        "salesInvoice.id",
        "salesInvoice.invoiceId",
        "salesInvoice.companyId",
        "salesInvoice.customerId",
        "salesInvoice.status",
        "salesInvoice.currencyCode",
        "salesInvoice.exchangeRate",
        "salesInvoice.dateIssued",
        "salesInvoice.dateDue",
        "salesInvoice.datePaid",
        "salesInvoice.customerReference",
        "salesInvoice.subtotal",
        "salesInvoice.totalTax",
        "salesInvoice.totalDiscount",
        "salesInvoice.totalAmount",
        "salesInvoices.balance",
        "salesInvoice.updatedAt"
      ])
      .where("salesInvoice.id", "in", ids)
      .where("salesInvoice.companyId", "=", this.companyId)
      .execute();

    if (invoiceRows.length === 0) return new Map();

    const lineRows = await this.database
      .selectFrom("salesInvoiceLine")
      .leftJoin("item", "item.id", "salesInvoiceLine.itemId")
      .select([
        "salesInvoiceLine.id",
        "salesInvoiceLine.invoiceId",
        "salesInvoiceLine.invoiceLineType",
        "salesInvoiceLine.itemId",
        "salesInvoiceLine.description",
        "salesInvoiceLine.quantity",
        "salesInvoiceLine.unitPrice",
        "salesInvoiceLine.taxPercent",
        "item.readableIdWithRevision as itemReadableIdWithRevision"
      ])
      .where(
        "salesInvoiceLine.invoiceId",
        "in",
        invoiceRows.map((r) => r.id)
      )
      .execute();

    const linesByInvoiceId = new Map<string, InvoiceLineRow[]>();
    for (const line of lineRows as InvoiceLineRow[]) {
      const existing = linesByInvoiceId.get(line.invoiceId) ?? [];
      existing.push(line);
      linesByInvoiceId.set(line.invoiceId, existing);
    }

    const result = new Map<string, Accounting.SalesInvoice>();
    for (const row of invoiceRows as InvoiceRow[]) {
      const lines = linesByInvoiceId.get(row.id) ?? [];

      result.set(row.id, {
        id: row.id,
        invoiceId: row.invoiceId,
        companyId: row.companyId,
        customerId: row.customerId,
        customerExternalId: null, // Resolved during mapToRemote
        status: row.status,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        dateIssued: row.dateIssued,
        dateDue: row.dateDue,
        datePaid: row.datePaid,
        customerReference: row.customerReference,
        subtotal: Number(row.subtotal) || 0,
        totalTax: Number(row.totalTax) || 0,
        totalDiscount: Number(row.totalDiscount) || 0,
        totalAmount: Number(row.totalAmount) || 0,
        balance: Number(row.balance) || 0,
        lines: lines.map((line) => {
          const quantity = Number(line.quantity) || 0;
          const unitPrice = Number(line.unitPrice) || 0;
          return {
            id: line.id,
            invoiceLineType: line.invoiceLineType,
            itemId: line.itemId,
            itemCode: line.itemReadableIdWithRevision,
            description: line.description,
            quantity,
            unitPrice,
            taxPercent: Number(line.taxPercent) || 0,
            lineAmount: quantity * unitPrice
          };
        }),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.Invoice | null> {
    return this.rilletProvider.getInvoice(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Invoice>> {
    const result = new Map<string, Rillet.Invoice>();
    for (const id of ids) {
      const invoice = await this.rilletProvider.getInvoice(id);
      if (invoice) result.set(invoice.id, invoice);
    }
    return result;
  }

  // =================================================================
  // 3. SHOULD SYNC (posted-invoice gate)
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.SalesInvoice, Rillet.Invoice>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Sales invoices are push-only; pulling invoices from Rillet is not supported";
    }

    if (context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Invoice must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.SalesInvoice
  ): Promise<RilletInvoiceCreate> {
    // JIT dependencies: customer, then every line item, before the document
    const customerRemoteId = await this.ensureDependencySynced(
      "customer",
      local.customerId
    );

    const itemRemoteIds = new Map<string, string>();
    for (const line of local.lines) {
      if (line.itemId && !itemRemoteIds.has(line.itemId)) {
        itemRemoteIds.set(
          line.itemId,
          await this.ensureDependencySynced("item", line.itemId)
        );
      }
    }

    // Dynamic import: keeps @carbon/env (module-load env validation) out of
    // the module graph for consumers and tests that never push an invoice
    // (same pattern as the payment syncer's auth import).
    const { getAppUrl } = await import("@carbon/env");

    return mapSalesInvoiceToRilletInvoice({
      invoice: local,
      customerRemoteId,
      itemRemoteIds,
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId,
      documentUrl: `${getAppUrl()}/x/sales-invoice/${local.id}`
    });
  }

  // =================================================================
  // 5. UPSERT REMOTE (create-only; RilletTransactionSyncer hard-skips
  //    already-mapped ids — updates are a follow-up)
  // =================================================================

  protected async upsertRemote(
    data: RilletInvoiceCreate,
    localId: string
  ): Promise<string> {
    try {
      const created = await this.rilletProvider.createInvoice(
        data,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "invoice",
          localId
        })
      );
      return created.id;
    } catch (error) {
      // AR_ONLY invoices REQUIRE external_references, so the optional-
      // reference strip fallback the master-data syncers use cannot apply —
      // registering the slugs in the Rillet dashboard is the only fix.
      if (isRilletUnknownExternalReferenceTypeError(error)) {
        throw new JournalEntrySyncError({
          errorCode: "EXTERNAL_REFERENCE_TYPE_MISSING",
          message: `Cannot sync invoice: Rillet requires external references on AR_ONLY invoices, and this organization has no "${RILLET_CARBON_REFERENCE_TYPE}" / "${RILLET_CARBON_COMPANY_REFERENCE_TYPE}" reference types registered. Add them under Rillet Settings → External References, then retry.`,
          warning: true,
          metadata: { invoiceId: localId }
        });
      }
      throw error;
    }
  }
}
