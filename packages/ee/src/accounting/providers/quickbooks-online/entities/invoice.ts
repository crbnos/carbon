import type { KyselyTx } from "@carbon/database/client";
import { datetime } from "@carbon/database/datetime";
import { parseDate } from "@internationalized/date";
import { createMappingService } from "../../../core/external-mapping";
import {
  JournalEntrySyncError,
  toPostingDateString
} from "../../../core/posting";
import {
  buildSalesDocumentComponents,
  type SalesDocumentComponents
} from "../../../core/sales-document-components";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { parseQboDate, type Qbo } from "../models";
import type { QboProvider } from "../provider";
import {
  loadQboInvoiceTaxCatalog,
  type QboInvoiceTaxCatalog,
  resolveQboInvoiceTax
} from "./invoice-tax";
import type { QboItemSyncer } from "./item";
import {
  buildQboDocNumberFields,
  loadQboAccountRefsById,
  type QboDocNumberSource,
  type QboWriteOmit,
  updateWithSyncTokenRetry
} from "./shared";

/**
 * QboSalesInvoiceSyncer — Carbon sales invoices ↔ QBO Invoice objects
 * (two-way, owner accounting per DEFAULT_SYNC_CONFIG; entityType
 * "invoice" like the Xero counterpart).
 *
 * Push: only posted invoices (same status gate as Xero's
 * SalesInvoiceSyncer). Customer and line items are JIT-synced via
 * ensureDependencySynced before the document; lines become
 * SalesItemLineDetail with ItemRef (the item's QBO id) + Qty/UnitPrice.
 * DocNumber carries the Carbon readable id when it fits QBO's 21-char cap;
 * otherwise PrivateNote carries it ("Carbon <id>"), QBO auto-numbers, and
 * the mapping metadata records which happened (`docNumberSource`).
 *
 * Pull mirrors the Xero counterpart's field set: dates and amounts come
 * back onto the Carbon document, with status derived from Balance/TotalAmt
 * (QBO invoices carry no status enum). Update-only — invoices are never
 * created from QBO.
 */

// Only posted invoices are pushed (behavior copied from the Xero syncer)
const SYNCABLE_STATUSES: Accounting.SalesInvoice["status"][] = [
  "Pending",
  "Submitted",
  "Partially Paid",
  "Paid",
  "Overdue"
];

// Row shapes for sales invoice queries (mirror the Xero syncer's)
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
  unitPrice: number;
  convertedUnitPrice: number | null;
  shippingCost: number | null;
  addOnCost: number | null;
  nonTaxableAddOnCost: number | null;
  taxPercent: number;
  itemReadableIdWithRevision: string | null;
};

/**
 * Derive the Carbon invoice status from QBO's Balance/TotalAmt (QBO has no
 * invoice status enum). Pure — exported for tests.
 */
export function deriveCarbonInvoiceStatus(
  totalAmt: number | undefined,
  balance: number | undefined
): Accounting.SalesInvoice["status"] | undefined {
  if (balance === undefined) return undefined;
  if (balance <= 0) return "Paid";
  if (totalAmt !== undefined && balance < totalAmt) return "Partially Paid";
  return "Submitted";
}

/**
 * Build QBO SalesItemLineDetail lines from Carbon invoice lines. Pure —
 * exported for tests. `itemRemoteIds` maps Carbon itemId → QBO item id
 * (resolved by ensureDependencySynced before mapping); lines without an
 * item ship without an ItemRef.
 */
export function buildQboInvoiceLines(args: {
  document: SalesDocumentComponents;
  itemRemoteIds: ReadonlyMap<string, string>;
  shippingItemRemoteId: string | null;
  lineTaxCodeRefs: ReadonlyMap<string, Qbo.Ref>;
}): Array<Omit<Qbo.InvoiceLine, "Id">> {
  return args.document.components.map((component) => {
    const shipping =
      component.kind === "LineShipping" || component.kind === "HeaderShipping";
    const itemId = shipping
      ? args.shippingItemRemoteId
      : component.itemId
        ? args.itemRemoteIds.get(component.itemId)
        : null;
    if ((shipping || component.itemId) && !itemId)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Invoice component ${component.id} has no QuickBooks item mapping`,
        metadata: {
          invoiceId: args.document.invoiceId,
          componentId: component.id
        }
      });
    const taxCode = args.lineTaxCodeRefs.get(component.id);
    if (!taxCode)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_TAX_CODES",
        warning: true,
        message: `Invoice component ${component.id} has no resolved QuickBooks tax code`,
        metadata: {
          invoiceId: args.document.invoiceId,
          componentId: component.id
        }
      });
    return {
      Description: component.description,
      Amount: component.netAmount,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: itemId ? { value: itemId } : undefined,
        Qty: component.quantity,
        UnitPrice: component.unitAmount,
        TaxCodeRef: taxCode
      }
    };
  });
}

export class QboSalesInvoiceSyncer extends BaseEntitySyncer<
  Accounting.SalesInvoice,
  Qbo.Invoice,
  QboWriteOmit
> {
  private taxCatalogPromise?: Promise<QboInvoiceTaxCatalog>;
  private shippingAccountPromise?: Promise<string>;
  private shippingItemSyncerPromise?: Promise<QboItemSyncer>;

  private getShippingAccountId(): Promise<string> {
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
        const refs = await loadQboAccountRefsById(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        if (
          !account ||
          account.class !== "Revenue" ||
          !account.active ||
          account.isGroup ||
          !id ||
          !refs.has(id)
        )
          throw new JournalEntrySyncError({
            errorCode: "UNMAPPED_ACCOUNTS",
            warning: true,
            message:
              "Cannot sync invoice: Shipping Revenue requires an active Revenue leaf with a QuickBooks account mapping",
            metadata: {
              accountId: id,
              missingDefaults: ["salesShippingRevenueAccount"]
            }
          });
        return id;
      })();
    return this.shippingAccountPromise;
  }

  private getShippingItemSyncer(): Promise<QboItemSyncer> {
    if (!this.shippingItemSyncerPromise)
      this.shippingItemSyncerPromise = (async () => {
        const [{ SyncFactory }, { QboItemSyncer }] = await Promise.all([
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
        if (!(syncer instanceof QboItemSyncer))
          throw new Error(
            "QuickBooks shipping requires the existing item syncer"
          );
        return syncer;
      })();
    return this.shippingItemSyncerPromise;
  }

  // Bookkeeping for linkEntities: concurrency metadata per remote id and
  // the DocNumber carrier per local id (recorded during mapToRemote)
  private remoteMetaById = new Map<
    string,
    { syncToken?: string; lastUpdatedTime?: string }
  >();
  private docNumberSourceByLocalId = new Map<string, QboDocNumberSource>();

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  private rememberRemoteEntity(
    remote: Pick<Qbo.Invoice, "Id" | "SyncToken" | "MetaData"> | null
  ): void {
    if (!remote?.Id) return;
    this.remoteMetaById.set(remote.Id, {
      syncToken: remote.SyncToken,
      lastUpdatedTime: remote.MetaData?.LastUpdatedTime
    });
  }

  // =================================================================
  // 1. ID MAPPING — mapping metadata records the DocNumber carrier
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const seen = this.remoteMetaById.get(remoteId);
    const docNumberSource = this.docNumberSourceByLocalId.get(localId);

    const metadata: Record<string, unknown> = {};
    if (seen?.syncToken !== undefined) metadata.syncToken = seen.syncToken;
    if (docNumberSource) metadata.docNumberSource = docNumberSource;

    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      "invoice",
      localId,
      this.provider.id,
      remoteId,
      {
        remoteUpdatedAt:
          remoteUpdatedAt ?? parseQboDate(seen?.lastUpdatedTime) ?? undefined,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {})
      }
    );

    // Also update updatedAt on salesInvoice (Xero-syncer parity)
    await tx
      .updateTable("salesInvoice")
      .set({ updatedAt: datetime.timestamp() })
      .where("id", "=", localId)
      .execute();
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Qbo.Invoice): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
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
          return {
            id: line.id,
            invoiceLineType: line.invoiceLineType,
            itemId: line.itemId,
            itemCode: line.itemReadableIdWithRevision,
            description: line.description,
            quantity,
            unitPrice,
            convertedUnitPrice:
              line.convertedUnitPrice == null
                ? null
                : Number(line.convertedUnitPrice),
            shippingCost: Number(line.shippingCost ?? 0),
            addOnCost: Number(line.addOnCost ?? 0),
            nonTaxableAddOnCost: Number(line.nonTaxableAddOnCost ?? 0),
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
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Qbo.Invoice | null> {
    const invoice = await this.qboProvider.getInvoice(id);
    this.rememberRemoteEntity(invoice);
    return invoice;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.Invoice>> {
    const result = new Map<string, Qbo.Invoice>();
    for (const id of ids) {
      const invoice = await this.fetchRemote(id);
      if (invoice) result.set(invoice.Id, invoice);
    }
    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.SalesInvoice
  ): Promise<Omit<Qbo.Invoice, QboWriteOmit>> {
    const document = buildSalesDocumentComponents(local);
    const remoteExchangeRate = 1 / local.exchangeRate;
    if (!Number.isFinite(remoteExchangeRate))
      throw new Error("QuickBooks exchange rate must be finite");
    let catalog: QboInvoiceTaxCatalog;
    try {
      this.taxCatalogPromise ??= loadQboInvoiceTaxCatalog(this.qboProvider);
      catalog = await this.taxCatalogPromise;
    } catch (error) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_TAX_CODES",
        warning: true,
        message: `Cannot read QuickBooks tax configuration: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          invoiceId: local.id,
          requestedRates: [
            ...new Set(document.components.map((line) => line.taxPercent))
          ],
          candidateTaxCodeIds: [],
          reason: "Tax catalog unavailable"
        }
      });
    }
    const tax = resolveQboInvoiceTax({ document, catalog });
    const hasShipping = document.components.some(
      (line) => line.kind === "LineShipping" || line.kind === "HeaderShipping"
    );
    const shippingAccountId = hasShipping
      ? await this.getShippingAccountId()
      : null;
    // Tax, account and currency preflight finishes before any dependency writes.
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
    const shippingItemRemoteId = shippingAccountId
      ? await (await this.getShippingItemSyncer()).ensureShippingItem({
          shippingAccountId
        })
      : null;
    const dueDate =
      local.dateDue ??
      parseDate(toPostingDateString(local.dateIssued ?? datetime.timestamp()))
        .add({ days: 30 })
        .toString();

    const docNumber = buildQboDocNumberFields(local.invoiceId);
    this.docNumberSourceByLocalId.set(local.id, docNumber.source);

    return {
      DocNumber: docNumber.DocNumber,
      PrivateNote: docNumber.PrivateNote,
      TxnDate: local.dateIssued ?? undefined,
      DueDate: dueDate,
      CustomerRef: { value: customerRemoteId },
      CurrencyRef: { value: document.currencyCode },
      ExchangeRate: remoteExchangeRate,
      ...(catalog.country.toUpperCase() === "US"
        ? {}
        : { GlobalTaxCalculation: "TaxExcluded" as const }),
      TxnTaxDetail: tax.txnTaxDetail,
      Line: buildQboInvoiceLines({
        document,
        itemRemoteIds,
        shippingItemRemoteId,
        lineTaxCodeRefs: tax.lineTaxCodeRefs
      })
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Qbo.Invoice
  ): Promise<Partial<Accounting.SalesInvoice>> {
    const lines: Accounting.SalesInvoiceLine[] = (remote.Line ?? [])
      .filter((line) => line.DetailType === "SalesItemLineDetail")
      .map((line, index) => ({
        id: line.Id ?? `line-${index}`,
        invoiceLineType: "Part",
        itemId: null, // Resolved by ItemRef mapping during upsertLocal if needed
        itemCode: null,
        description: line.Description ?? null,
        quantity: line.SalesItemLineDetail?.Qty ?? 0,
        unitPrice: line.SalesItemLineDetail?.UnitPrice ?? 0,
        shippingCost: 0,
        addOnCost: 0,
        nonTaxableAddOnCost: 0,
        taxPercent: 0,
        lineAmount: line.Amount
      }));

    return {
      status: deriveCarbonInvoiceStatus(remote.TotalAmt, remote.Balance),
      dateIssued: remote.TxnDate ?? null,
      dateDue: remote.DueDate ?? null,
      totalAmount: remote.TotalAmt ?? 0,
      balance: remote.Balance ?? 0,
      lines
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL (Update existing only)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.SalesInvoice>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new invoices from QuickBooks Online. Invoice with remote ID ${remoteId} not found locally.`
      );
    }

    await tx
      .updateTable("salesInvoice")
      .set({
        status: data.status,
        dateIssued: data.dateIssued,
        dateDue: data.dateDue,
        totalAmount: data.totalAmount,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", existingLocalId)
      .execute();

    // Line items are not updated from QBO to preserve Carbon's line
    // structure (Xero-syncer parity)

    return existingLocalId;
  }

  // =================================================================
  // 8. UPSERT REMOTE (create, or sparse update with SyncToken retry)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Qbo.Invoice, QboWriteOmit>,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (!existingRemoteId) {
      const created = await this.qboProvider.createInvoice(data);
      this.rememberRemoteEntity(created);
      return created.Id;
    }

    const updated = await updateWithSyncTokenRetry({
      entityLabel: "invoice",
      remoteId: existingRemoteId,
      fetchCurrent: () => this.qboProvider.getInvoice(existingRemoteId),
      update: (syncToken) =>
        this.qboProvider.updateInvoice({
          ...data,
          Id: existingRemoteId,
          SyncToken: syncToken
        })
    });
    this.rememberRemoteEntity(updated);
    return updated.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Qbo.Invoice, QboWriteOmit>;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }

  // =================================================================
  // 9. SHOULD SYNC (same gate as the Xero counterpart)
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.SalesInvoice, Qbo.Invoice>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Invoice must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
