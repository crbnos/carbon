import { datetime } from "@carbon/database/datetime";
import {
  JournalEntrySyncError,
  toPostingDateString
} from "../../../core/posting";
import {
  buildSalesDocumentComponents,
  type SalesDocumentComponents
} from "../../../core/sales-document-components";
import {
  loadSalesInvoices,
  requirePostedShippingAccountId
} from "../../../core/sales-invoice-source";
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
  toRilletExchangeRate,
  toRilletMoney
} from "./shared";

/**
 * RilletSalesInvoiceSyncer — Carbon sales invoices → Rillet revenue recognition
 * invoices (push-only; entityType "invoice").
 *
 * REVENUE_RECOGNITION_ONLY keeps Carbon as the invoice issuer while Rillet
 * carries receivables and recognizes net revenue on the posting date. Unlike
 * AR_ONLY, the v4 scope honors the fixed document-to-subsidiary exchange rate.
 *
 * Customer and line items are JIT-synced via ensureDependencySynced
 * before the document. Rillet revenue recognition items REQUIRE a product_id, so a
 * line without a Carbon item cannot be represented — it fails with a
 * structured Warning listing the lines (UNMAPPED_ACCOUNTS envelope: the
 * closest user-fixable code available; the core error-code list has no
 * missing-item code yet).
 *
 * Posted amounts stay immutable. A local void deletes the native invoice;
 * its retained mapping prevents duplicate creation or deletion on retries.
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

/**
 * Map a Carbon sales invoice to the Rillet revenue recognition create payload. Pure —
 * exported for tests. `itemRemoteIds` maps Carbon itemId → Rillet product
 * id (resolved by ensureDependencySynced before mapping).
 *
 * Throws the structured UNMAPPED_ACCOUNTS Warning when any line has no
 * item (REVENUE_RECOGNITION_ONLY items require product_id), and a plain Error when a
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
        "Cannot sync invoice: Rillet revenue recognition lines require a product and positive quantity; some components have no item or unsupported quantities",
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
  const invoiceDate = toPostingDateString(
    invoice.postingDate ?? invoice.dateIssued ?? datetime.timestamp()
  );
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
      revenue: {
        period: { start: invoiceDate, end: invoiceDate },
        pattern: "DAILY",
        ...(shipping ? { account_code: args.shippingAccountCode! } : {})
      },
      external_references: [
        customerCustomExternalReference(component.id, args.documentUrl)
      ]
    };
  });

  return {
    scope: "REVENUE_RECOGNITION_ONLY",
    exchange_rate: toRilletExchangeRate({
      baseCurrencyCode: invoice.baseCurrencyCode,
      documentCurrencyCode: currency,
      foreignPerBaseRate: invoice.exchangeRate,
      date: invoiceDate
    }),
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

  private shippingAccountCodesPromise?: ReturnType<
    typeof loadRilletAccountCodesById
  >;
  private shippingItemSyncerPromise?: Promise<RilletItemSyncer>;

  private async getShippingAccount(
    local: Accounting.SalesInvoice
  ): Promise<{ id: string; code: string }> {
    const id = requirePostedShippingAccountId(local);
    this.shippingAccountCodesPromise ??= loadRilletAccountCodesById(
      this.database,
      {
        companyId: this.companyId,
        integration: this.provider.id
      }
    ).catch((error) => {
      this.shippingAccountCodesPromise = undefined;
      throw error;
    });
    const code = (await this.shippingAccountCodesPromise).get(id);
    if (!code)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message:
          "Cannot sync invoice: original Shipping Revenue account has no Rillet mapping",
        metadata: { invoiceId: local.id, unmappedAccountIds: [id] }
      });
    return { id, code };
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

  protected isVoided(local: Accounting.SalesInvoice): boolean {
    return local.status === "Voided";
  }

  protected async deleteRemote(remoteId: string): Promise<void> {
    await this.rilletProvider.deleteInvoice(remoteId);
  }

  async fetchLocal(id: string): Promise<Accounting.SalesInvoice | null> {
    const invoices = await this.fetchInvoicesByIds([id]);
    return invoices.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    return this.fetchInvoicesByIds(ids);
  }

  private fetchInvoicesByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    return loadSalesInvoices(this.database, { companyId: this.companyId, ids });
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
      ? await this.getShippingAccount(local)
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
      // REVENUE_RECOGNITION_ONLY invoices REQUIRE external_references, so the optional-
      // reference strip fallback the master-data syncers use cannot apply —
      // registering the slugs in the Rillet dashboard is the only fix.
      if (isRilletUnknownExternalReferenceTypeError(error)) {
        throw new JournalEntrySyncError({
          errorCode: "EXTERNAL_REFERENCE_TYPE_MISSING",
          message: `Cannot sync invoice: Rillet requires external references on REVENUE_RECOGNITION_ONLY invoices, and this organization has no "${RILLET_CARBON_REFERENCE_TYPE}" / "${RILLET_CARBON_COMPANY_REFERENCE_TYPE}" reference types registered. Add them under Rillet Settings → External References, then retry.`,
          warning: true,
          metadata: { invoiceId: localId }
        });
      }
      throw error;
    }
  }
}
