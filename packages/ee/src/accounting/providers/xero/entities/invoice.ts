// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { KyselyTx } from "@carbon/database/client";
import { datetime, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { loadAccountCodesById } from "../../../core/account-mapping";
import { createMappingService } from "../../../core/external-mapping";
import {
  JournalEntrySyncError,
  toPostingDateString
} from "../../../core/posting";
import {
  assertNoAssetDisposalComponents,
  buildSalesDocumentComponents,
  hasSalesRevenueComponent,
  hasServiceRevenueComponent,
  isServiceRevenueComponent,
  type SalesDocumentComponent,
  type SalesDocumentComponents
} from "../../../core/sales-document-components";
import {
  loadSalesInvoices,
  requirePostedSalesAccountId,
  requirePostedServiceRevenueAccountId,
  requirePostedShippingAccountId
} from "../../../core/sales-invoice-source";
import {
  type Accounting,
  BaseEntitySyncer,
  type BatchSyncResult,
  type RemoteUpsertOutcome,
  type ShouldSyncContext,
  type SyncResult
} from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, toXeroDateString, type Xero } from "../models";
import type { XeroProvider } from "../provider";
import { assertXeroMoneyPrecision } from "../serialize";
import { resolveXeroTaxType, XeroTaxContextLoader } from "../tax";
import { mergeBatchResults, pushXeroVoids } from "./void";

// Note: This syncer uses the default ID mapping from BaseEntitySyncer
// which uses the externalIntegrationMapping table with entityType "invoice"

// Status mapping: Carbon -> Xero
const CARBON_TO_XERO_STATUS: Record<
  Accounting.SalesInvoice["status"],
  Xero.Invoice["Status"]
> = {
  Draft: "DRAFT",
  Pending: "SUBMITTED",
  Submitted: "AUTHORISED",
  "Partially Paid": "AUTHORISED",
  // Xero refuses PAID on a write; it marks the invoice paid itself once the
  // payment push applies the payments.
  Paid: "AUTHORISED",
  Overdue: "AUTHORISED",
  Voided: "VOIDED",
  "Credit Note Issued": "AUTHORISED",
  Return: "AUTHORISED"
};

// Status mapping: Xero -> Carbon
const XERO_TO_CARBON_STATUS: Record<
  Xero.Invoice["Status"],
  Accounting.SalesInvoice["status"]
> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending",
  AUTHORISED: "Submitted",
  PAID: "Paid",
  VOIDED: "Voided",
  DELETED: "Voided"
};

// Syncable statuses (we only push posted invoices to Xero, not drafts)
const SYNCABLE_STATUSES: Accounting.SalesInvoice["status"][] = [
  "Pending",
  "Submitted",
  "Partially Paid",
  "Paid",
  "Overdue"
];

export function buildXeroSalesInvoiceLines(args: {
  document: SalesDocumentComponents;
  salesAccountCode: string;
  /** The Service Revenue account code; a service job's components. */
  serviceAccountCode: string | null;
  shippingAccountCode: string | null;
  /** The component's Xero `TaxType` on its account (`resolveXeroTaxType`). */
  resolveTaxType: (
    component: SalesDocumentComponent,
    accountCode: string
  ) => string;
}): Xero.InvoiceLineItem[] {
  assertXeroMoneyPrecision(
    args.document.subtotal,
    args.document.totalTax,
    args.document.totalAmount,
    args.document.balance,
    ...args.document.components.flatMap((component) => [
      component.netAmount,
      component.taxAmount
    ])
  );
  return args.document.components.map((component) => {
    const shipping =
      component.kind === "LineShipping" || component.kind === "HeaderShipping";
    const service = !shipping && isServiceRevenueComponent(component);
    const accountCode = shipping
      ? args.shippingAccountCode
      : service
        ? args.serviceAccountCode
        : args.salesAccountCode;
    if (!accountCode)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Cannot sync invoice: missing ${shipping ? "shipping revenue" : service ? "service revenue" : "sales"} account mapping`,
        metadata: { invoiceId: args.document.invoiceId }
      });
    if (Math.abs(component.taxAmount) > Math.abs(component.netAmount)) {
      throw new Error(
        "Xero tax override cannot exceed its monetary line unit amount"
      );
    }
    // A monetary unit preserves exact net/native tax even for bulk quantities
    // or source unit prices finer than Xero supports. Keep the source detail.
    const description =
      component.quantity === 1 && component.unitAmount === component.netAmount
        ? component.description
        : `${component.description} (${component.quantity} × ${component.unitAmount} ${args.document.currencyCode})`;
    return {
      Description: description,
      Quantity: 1,
      UnitAmount: component.netAmount,
      LineAmount: component.netAmount,
      TaxAmount: component.taxAmount,
      TaxType: args.resolveTaxType(component, accountCode),
      // No `ItemCode`. Xero lines are already account-coded, so the item was
      // pure subledger detail — and carrying it meant mirroring Carbon's whole
      // manufacturing parts catalog into Xero Items. The item name stays in
      // Description, which is where a person reads it anyway.
      AccountCode: accountCode
    };
  });
}

export class SalesInvoiceSyncer extends BaseEntitySyncer<
  Accounting.SalesInvoice,
  Xero.Invoice,
  "UpdatedDateUTC"
> {
  private accountCodesPromise?: ReturnType<typeof loadAccountCodesById>;
  private readonly taxContext = new XeroTaxContextLoader(
    this.database,
    { companyId: this.companyId, integration: this.provider.id },
    this.provider as XeroProvider
  );

  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  // A synced invoice voided in Carbon is voided in Xero, not pushed again.
  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (this.config.enabled) {
      const voids = await this.pushVoids([entityId]);
      if (voids.results[0]) return voids.results[0];
    }
    return super.pushToAccounting(entityId);
  }

  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    if (!this.config.enabled) return super.pushBatchToAccounting(entityIds);
    const voids = await this.pushVoids(entityIds);
    const rest =
      voids.remaining.length > 0
        ? await super.pushBatchToAccounting(voids.remaining)
        : null;
    return mergeBatchResults(voids.results, rest);
  }

  private pushVoids(entityIds: string[]) {
    return pushXeroVoids({
      database: this.database,
      companyId: this.companyId,
      provider: this.xeroProvider,
      entityType: "invoice",
      entityIds
    });
  }

  /**
   * The Xero AccountCode merchandise lines post to: the account the ORIGINAL
   * journal credited, resolved through the account mapping.
   *
   * Replayed from the posted journal rather than read from
   * `accountDefault.salesAccount`, for the same reason shipping already did:
   * changing the default after posting must not change the account a retry
   * uses. No blunt default-account-code fallback — an unmapped account throws
   * the structured UNMAPPED_ACCOUNTS Warning so the gap is surfaced and fixed
   * rather than silently posted somewhere wrong.
   */
  private getSalesAccountCode(local: Accounting.SalesInvoice): Promise<string> {
    return this.getRevenueAccountCode(
      local,
      requirePostedSalesAccountId(local),
      "Sales Revenue"
    );
  }

  /** The same replay for a service job's lines: the Service Revenue account. */
  private getServiceAccountCode(
    local: Accounting.SalesInvoice
  ): Promise<string> {
    return this.getRevenueAccountCode(
      local,
      requirePostedServiceRevenueAccountId(local),
      "Service Revenue"
    );
  }

  private async getRevenueAccountCode(
    local: Accounting.SalesInvoice,
    id: string,
    label: string
  ): Promise<string> {
    this.accountCodesPromise ??= loadAccountCodesById(this.database, {
      companyId: this.companyId,
      integration: this.provider.id
    }).catch((error) => {
      this.accountCodesPromise = undefined;
      throw error;
    });
    const code = (await this.accountCodesPromise).get(id);
    if (!code)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Cannot sync invoice: original ${label} account has no Xero mapping`,
        metadata: { invoiceId: local.id, unmappedAccountIds: [id] }
      });
    return code;
  }

  private async getShippingAccountCode(
    local: Accounting.SalesInvoice
  ): Promise<string> {
    const id = requirePostedShippingAccountId(local);
    this.accountCodesPromise ??= loadAccountCodesById(this.database, {
      companyId: this.companyId,
      integration: this.provider.id
    }).catch((error) => {
      this.accountCodesPromise = undefined;
      throw error;
    });
    const code = (await this.accountCodesPromise).get(id);
    if (!code)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message:
          "Cannot sync invoice: original Shipping Revenue account has no Xero mapping",
        metadata: { invoiceId: local.id, unmappedAccountIds: [id] }
      });
    return code;
  }

  // =================================================================
  // 1. ID MAPPING - Uses default implementation from BaseEntitySyncer
  // The entityType "invoice" maps to the salesInvoice table
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date,
    lastSyncedAt?: string
  ): Promise<void> {
    // Use the mapping service to link invoice -> salesInvoice
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      "invoice",
      localId,
      this.provider.id,
      remoteId,
      { remoteUpdatedAt, lastSyncedAt }
    );
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
  // 4. REMOTE FETCH (Single + Batch) - API calls within syncer
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.Invoice | null> {
    const result = await this.xeroProvider.request<{
      Invoices: Xero.Invoice[];
    }>("GET", `/Invoices/${id}`);
    return result.error ? null : (result.data?.Invoices?.[0] ?? null);
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
      throwXeroApiError("fetch invoices batch", response);
    }

    if (response.data?.Invoices) {
      for (const invoice of response.data.Invoices) {
        result.set(invoice.InvoiceID, invoice);
      }
    }

    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.SalesInvoice
  ): Promise<Omit<Xero.Invoice, "UpdatedDateUTC">> {
    const document = buildSalesDocumentComponents(local);
    const hasShipping = document.components.some(
      (line) => line.kind === "LineShipping" || line.kind === "HeaderShipping"
    );
    // A fixed-asset disposal has no sales-revenue posting to replay, so it is
    // refused rather than coded to the sales account and reported as revenue.
    assertNoAssetDisposalComponents(document);
    const salesAccountCode = hasSalesRevenueComponent(document.components)
      ? await this.getSalesAccountCode(local)
      : "";
    const serviceAccountCode = hasServiceRevenueComponent(document.components)
      ? await this.getServiceAccountCode(local)
      : null;
    const shippingAccountCode = hasShipping
      ? await this.getShippingAccountCode(local)
      : null;
    const taxContext = await this.taxContext.forLines(
      "sales",
      document.components
    );
    const lineItems = buildXeroSalesInvoiceLines({
      document,
      salesAccountCode,
      serviceAccountCode,
      shippingAccountCode,
      resolveTaxType: (component, accountCode) =>
        resolveXeroTaxType({
          context: taxContext,
          documentId: local.id,
          direction: "sales",
          taxCodeId: component.taxCodeId,
          taxPercent: component.taxPercent,
          taxAmount: component.taxAmount,
          netAmount: component.netAmount,
          decimalPlaces: document.decimalPlaces,
          accountCode
        })
    });
    // All currency/account/component/tax requirements are checked before
    // dependency writes, so an UNMAPPED_TAX_CODES Warning provisions nothing.
    const existingRemoteId = await this.getRemoteId(local.id);
    const customerRemoteId = await this.ensureDependencySynced(
      "customer",
      local.customerId
    );
    const dueDate =
      local.dateDue ??
      parseDate(toPostingDateString(local.dateIssued ?? datetime.timestamp()))
        .add({ days: 30 })
        .toString();

    return {
      InvoiceID: existingRemoteId!,
      Type: "ACCREC", // Accounts Receivable = Sales Invoice
      InvoiceNumber: local.invoiceId,
      Reference: local.customerReference ?? undefined,
      Contact: {
        ContactID: customerRemoteId
      },
      Date: local.dateIssued ?? undefined,
      DueDate: dueDate,
      Status: CARBON_TO_XERO_STATUS[local.status],
      LineAmountTypes: "Exclusive", // Tax is calculated separately
      LineItems: lineItems,
      SubTotal: document.subtotal,
      TotalTax: document.totalTax,
      Total: document.totalAmount,
      AmountDue: document.balance,
      AmountPaid: round(
        document.totalAmount - document.balance,
        document.decimalPlaces
      ),
      CurrencyCode: local.currencyCode,
      // Xero stores foreign per base too. A foreign negotiated 1:1 must be
      // explicit; omission would let Xero choose its own market rate.
      CurrencyRate:
        local.currencyCode !== local.baseCurrencyCode
          ? local.exchangeRate
          : undefined
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon) - Update only
  // =================================================================

  protected async mapToLocal(
    remote: Xero.Invoice
  ): Promise<Partial<Accounting.SalesInvoice>> {
    // Map Xero line items to Carbon line format
    const lines: Accounting.SalesInvoiceLine[] = (remote.LineItems ?? []).map(
      (line, index) => ({
        id: line.LineItemID ?? `line-${index}`,
        invoiceLineType: "Part", // Default, will be matched with existing lines
        itemId: null, // Will be resolved by looking up ItemCode
        itemCode: line.ItemCode ?? null,
        description: line.Description ?? null,
        quantity: line.Quantity ?? 0,
        unitPrice: line.UnitAmount ?? 0,
        shippingCost: 0,
        addOnCost: 0,
        nonTaxableAddOnCost: 0,
        taxPercent: line.TaxAmount
          ? (line.TaxAmount / (line.LineAmount ?? 1)) * 100 || 0
          : 0,
        lineAmount: line.LineAmount ?? 0
      })
    );

    return {
      status: XERO_TO_CARBON_STATUS[remote.Status],
      dateIssued: toXeroDateString(remote.Date),
      dateDue: toXeroDateString(remote.DueDate),
      customerReference: remote.Reference ?? null,
      subtotal: remote.SubTotal ?? 0,
      totalTax: remote.TotalTax ?? 0,
      totalAmount: remote.Total ?? 0,
      balance: remote.AmountDue ?? 0,
      currencyCode: remote.CurrencyCode ?? "USD",
      exchangeRate: remote.CurrencyRate ?? 1,
      lines
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL (Update existing only - Carbon is source of truth)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.SalesInvoice>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new invoices from Xero. Invoice with remote ID ${remoteId} not found locally.`
      );
    }

    // Update invoice header (mapping is handled by linkEntities in base class)
    await tx
      .updateTable("salesInvoice")
      .set({
        status: data.status,
        dateIssued: data.dateIssued,
        dateDue: data.dateDue,
        customerReference: data.customerReference,
        subtotal: data.subtotal,
        totalTax: data.totalTax,
        totalAmount: data.totalAmount,
        currencyCode: data.currencyCode,
        exchangeRate: data.exchangeRate,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", existingLocalId)
      .execute();

    // Note: We don't update line items from Xero to preserve Carbon's line structure
    // Lines are only updated from Carbon -> Xero direction

    return existingLocalId;
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch) - API calls within syncer
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.Invoice, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    return this.xeroProvider.upsertInvoiceDocument({
      type: "ACCREC",
      data,
      existingRemoteId: await this.getRemoteId(localId),
      mayExist: this.mayExistRemotely(localId),
      key: this.createKey(localId)
    });
  }

  /**
   * One request for the invoices that need no lookup, and one each for an
   * unmapped invoice an earlier attempt may have created
   * (`XeroProvider.upsertInvoiceDocuments`).
   */
  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.Invoice, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, RemoteUpsertOutcome>> {
    const mappings = await this.mappingService.getByEntities(
      this.entityType,
      data.map(({ localId }) => localId),
      this.provider.id
    );
    const documents = data.map(({ localId, payload }) => ({
      localId,
      data: payload,
      existingRemoteId: mappings.get(localId)?.externalId ?? null,
      mayExist: this.mayExistRemotely(localId),
      key: this.createKey(localId)
    }));
    return this.xeroProvider.upsertInvoiceDocuments({
      type: "ACCREC",
      documents,
      batchKey: this.createKey(
        data
          .map(({ localId }) => localId)
          .sort()
          .join(","),
        "invoiceBatch"
      )
    });
  }

  // =================================================================
  // 9. SHOULD SYNC: Business logic for sync eligibility
  // =================================================================

  /**
   * Determine if an invoice should be synced based on its status.
   * Only invoices with syncable statuses (not Draft or Cancelled) are synced.
   */
  protected shouldSync(
    context: ShouldSyncContext<Accounting.SalesInvoice, Xero.Invoice>
  ): boolean | string {
    // For push operations, check the local entity status
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Invoice must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    // Carbon owns sales invoices: one raised in Xero is not imported. Skipped,
    // not Failed, since nothing went wrong.
    if (context.direction === "pull" && context.isFirstSync) {
      return "Sales invoices are raised in Carbon; an invoice created in Xero is not imported";
    }

    return true;
  }
}
