import { datetime } from "@carbon/database/datetime";
import {
  JournalEntrySyncError,
  toPostingDateString
} from "../../../core/posting";
import {
  buildSalesDocumentComponents,
  type SalesDocumentComponents
} from "../../../core/sales-document-components";
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
import type { RilletItemSyncer } from "./item";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  customerCustomExternalReference,
  loadRilletAccountCodesById,
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
  headerShippingCost: number | null;
  baseCurrencyCode: string;
  baseCurrencyDecimalPlaces: number | null;
  currencyDecimalPlaces: number | null;
  updatedAt: string | null;
};

type InvoiceLineRow = {
  id: string;
  invoiceId: string;
  invoiceLineType: string;
  itemId: string | null;
  description: string | null;
  quantity: number;
  /** BASE currency, as stored. */
  unitPrice: number;
  /** Document-currency mirror (unitPrice * exchangeRate). */
  convertedUnitPrice: number | null;
  shippingCost: number | null;
  addOnCost: number | null;
  nonTaxableAddOnCost: number | null;
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
function preflightRilletComponents(document: SalesDocumentComponents): void {
  const unsupported = document.components.filter(
    (line) =>
      (line.kind !== "LineShipping" &&
        line.kind !== "HeaderShipping" &&
        !line.itemId) ||
      line.quantity < 0.00001
  );
  if (unsupported.length > 0)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync invoice: Rillet AR_ONLY lines require a product and positive quantity; some components have no item or unsupported quantities",
      metadata: {
        invoiceId: document.invoiceId,
        componentIds: unsupported.map((line) => line.id)
      }
    });
}

export function mapSalesInvoiceToRilletInvoice(args: {
  invoice: Accounting.SalesInvoice;
  document: SalesDocumentComponents;
  shippingProductRemoteId: string | null;
  shippingAccountCode: string | null;
  customerRemoteId: string;
  itemRemoteIds: ReadonlyMap<string, string>;
  subsidiaryId: string | null;
  companyId: string;
  /** Link back to the Carbon invoice — REQUIRED by Rillet on
   * CUSTOMER_CUSTOM references. */
  documentUrl: string;
}): RilletInvoiceCreate {
  const { invoice } = args;
  const document = args.document;
  const currency = document.currencyCode;
  preflightRilletComponents(document);
  const items: Rillet.InvoiceItem[] = document.components.map((component) => {
    const shipping =
      component.kind === "LineShipping" || component.kind === "HeaderShipping";
    const productId = shipping
      ? args.shippingProductRemoteId
      : args.itemRemoteIds.get(component.itemId!);
    if (!productId || (shipping && !args.shippingAccountCode))
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Invoice component ${component.id} has no resolved Rillet product/account mapping`,
        metadata: { invoiceId: document.invoiceId, componentId: component.id }
      });
    return {
      product_id: productId,
      description: component.description,
      quantity: component.quantity,
      total_amount: toRilletMoney(
        component.netAmount,
        currency,
        document.decimalPlaces
      ),
      ...(shipping
        ? { revenue: { account_code: args.shippingAccountCode! } }
        : {}),
      external_references: [
        customerCustomExternalReference(component.id, args.documentUrl)
      ]
    };
  });

  const invoiceDate = toPostingDateString(
    invoice.dateIssued ?? datetime.timestamp()
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
    ...(document.totalTax !== 0
      ? {
          tax_amount: toRilletMoney(
            document.totalTax,
            currency,
            document.decimalPlaces
          )
        }
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

  private shippingAccountPromise?: Promise<{ id: string; code: string }>;
  private shippingItemSyncerPromise?: Promise<RilletItemSyncer>;

  private getShippingAccount(): Promise<{ id: string; code: string }> {
    if (!this.shippingAccountPromise)
      this.shippingAccountPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select("salesShippingRevenueAccount")
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();
        const id = defaults?.salesShippingRevenueAccount;
        const account = id
          ? await this.database
              .selectFrom("account as a")
              .innerJoin("company as c", "c.companyGroupId", "a.companyGroupId")
              .select(["a.id", "a.class", "a.active", "a.isGroup"])
              .where("c.id", "=", this.companyId)
              .where("a.id", "=", id)
              .executeTakeFirst()
          : undefined;
        const codes = await loadRilletAccountCodesById(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        const code = id ? codes.get(id) : undefined;
        if (
          !account ||
          account.class !== "Revenue" ||
          !account.active ||
          account.isGroup ||
          !id ||
          !code
        )
          throw new JournalEntrySyncError({
            errorCode: "UNMAPPED_ACCOUNTS",
            warning: true,
            message:
              "Cannot sync invoice: Shipping Revenue requires an active Revenue leaf with a Rillet account mapping",
            metadata: {
              accountId: id,
              missingDefaults: ["salesShippingRevenueAccount"]
            }
          });
        return { id, code };
      })();
    return this.shippingAccountPromise;
  }

  private getShippingItemSyncer(): Promise<RilletItemSyncer> {
    if (!this.shippingItemSyncerPromise)
      this.shippingItemSyncerPromise = (async () => {
        const [{ SyncFactory }, { RilletItemSyncer }] = await Promise.all([
          import("../../../core/sync"),
          import("./item")
        ]);
        const syncer = SyncFactory.getSyncer({
          ...this.context,
          entityType: "item",
          config: this.provider.getSyncConfig("item") ?? {
            enabled: true,
            direction: "push-to-accounting",
            owner: "carbon"
          }
        });
        if (!(syncer instanceof RilletItemSyncer))
          throw new Error("Rillet shipping requires the existing item syncer");
        return syncer;
      })();
    return this.shippingItemSyncerPromise;
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
      .leftJoin("salesInvoices", (join) =>
        join
          .onRef("salesInvoices.id", "=", "salesInvoice.id")
          .onRef("salesInvoices.companyId", "=", "salesInvoice.companyId")
      )
      .innerJoin("company", "company.id", "salesInvoice.companyId")
      .leftJoin("salesInvoiceShipment", (join) =>
        join
          .onRef("salesInvoiceShipment.id", "=", "salesInvoice.id")
          .onRef(
            "salesInvoiceShipment.companyId",
            "=",
            "salesInvoice.companyId"
          )
      )
      .leftJoin("currency as documentCurrency", (join) =>
        join
          .onRef("documentCurrency.code", "=", "salesInvoice.currencyCode")
          .onRef(
            "documentCurrency.companyGroupId",
            "=",
            "company.companyGroupId"
          )
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
      .where("salesInvoice.companyId", "=", this.companyId)
      .execute();

    if (invoiceRows.length === 0) return new Map();

    const lineRows = await this.database
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
      .where("salesInvoiceLine.companyId", "=", this.companyId)
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
        customerExternalId: null, // Resolved during mapToRemote
        status: row.status,
        currencyCode: row.currencyCode,
        baseCurrencyCode: row.baseCurrencyCode,
        baseCurrencyDecimalPlaces: Number(row.baseCurrencyDecimalPlaces),
        currencyDecimalPlaces: Number(row.currencyDecimalPlaces),
        headerShippingCost: Number(row.headerShippingCost ?? 0),
        exchangeRate: Number(row.exchangeRate),
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
            taxPercent: Number(line.taxPercent) || 0,
            lineAmount: quantity * unitPrice
          };
        }),
        updatedAt: row.updatedAt ?? datetime.timestamp(),
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
    const document = buildSalesDocumentComponents(local);
    preflightRilletComponents(document);
    const hasShipping = document.components.some(
      (line) => line.kind === "LineShipping" || line.kind === "HeaderShipping"
    );
    const shippingAccount = hasShipping
      ? await this.getShippingAccount()
      : null;
    const customerRemoteId = await this.ensureDependencySynced(
      "customer",
      local.customerId
    );
    const itemRemoteIds = new Map<string, string>();
    const itemIds = [
      ...new Set(
        document.components
          .filter(
            (line) =>
              line.kind !== "LineShipping" &&
              line.kind !== "HeaderShipping" &&
              line.itemId
          )
          .map((line) => line.itemId!)
      )
    ];
    for (const itemId of itemIds)
      itemRemoteIds.set(
        itemId,
        await this.ensureDependencySynced("item", itemId)
      );
    const shippingProductRemoteId = shippingAccount
      ? await (await this.getShippingItemSyncer()).ensureShippingProduct({
          shippingAccountId: shippingAccount.id,
          baseCurrencyCode: local.baseCurrencyCode,
          baseCurrencyDecimals: local.baseCurrencyDecimalPlaces
        })
      : null;

    // Dynamic import: keeps @carbon/env (module-load env validation) out of
    // the module graph for consumers and tests that never push an invoice
    // (same pattern as the payment syncer's auth import).
    const { getAppUrl } = await import("@carbon/env");

    return mapSalesInvoiceToRilletInvoice({
      invoice: local,
      document,
      shippingProductRemoteId,
      shippingAccountCode: shippingAccount?.code ?? null,
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
