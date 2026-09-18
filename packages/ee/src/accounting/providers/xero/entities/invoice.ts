import type { KyselyTx } from "@carbon/database/client";
import { datetime } from "@carbon/database/datetime";
import { round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { loadAccountCodesById } from "../../../core/account-mapping";
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
  loadSalesInvoices,
  requirePostedShippingAccountId
} from "../../../core/sales-invoice-source";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";
import { assertXeroMoneyPrecision } from "../serialize";

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
  Paid: "PAID",
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
  shippingAccountCode: string | null;
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
    const accountCode = shipping
      ? args.shippingAccountCode
      : args.salesAccountCode;
    if (!accountCode)
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Cannot sync invoice: missing ${shipping ? "shipping revenue" : "sales"} account mapping`,
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
      TaxType: component.taxPercent !== 0 ? "OUTPUT" : "NONE",
      AccountCode: accountCode,
      ...(component.kind === "Merchandise" && component.itemCode
        ? { ItemCode: component.itemCode.slice(0, 30) }
        : {})
    };
  });
}

export class SalesInvoiceSyncer extends BaseEntitySyncer<
  Accounting.SalesInvoice,
  Xero.Invoice,
  "UpdatedDateUTC"
> {
  private salesAccountCodePromise?: Promise<string>;
  private shippingAccountCodesPromise?: ReturnType<typeof loadAccountCodesById>;

  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  /**
   * The Xero AccountCode item-referenced AR invoice lines post to: the item's
   * mapped REVENUE account (`accountDefault.salesAccount` → the account-mapping
   * externalCode) — the same resolution that feeds Rillet's product
   * `account_code` and QBO's `IncomeAccountRef`. No blunt default-account-code
   * fallback: when the company default is unset or unmapped, throws the
   * structured UNMAPPED_ACCOUNTS Warning (same contract as the Rillet/QBO item
   * syncers' revenue-account check) so the gap is surfaced and fixed rather
   * than silently posted to the wrong account. Per-company defaults are
   * resolved once.
   */
  private getSalesAccountCode(): Promise<string> {
    if (!this.salesAccountCodePromise) {
      this.salesAccountCodePromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select("salesAccount")
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        if (!defaults?.salesAccount) {
          throw new JournalEntrySyncError({
            errorCode: "UNMAPPED_ACCOUNTS",
            message:
              "Cannot sync invoice: the company account defaults are missing salesAccount — Xero invoice lines require a revenue account code. Map the account on the integration settings page, then retry.",
            warning: true,
            metadata: { missingDefaults: ["salesAccount"] }
          });
        }

        const codesById = await loadAccountCodesById(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        const code = codesById.get(defaults.salesAccount);
        if (!code) {
          throw new JournalEntrySyncError({
            errorCode: "UNMAPPED_ACCOUNTS",
            message:
              "Cannot sync invoice: the default sales account has no Xero account mapping. Map the account on the integration settings page, then retry.",
            warning: true,
            metadata: { unmappedAccountIds: [defaults.salesAccount] }
          });
        }
        return code;
      })();
    }
    return this.salesAccountCodePromise;
  }

  private async getShippingAccountCode(
    local: Accounting.SalesInvoice
  ): Promise<string> {
    const id = requirePostedShippingAccountId(local);
    this.shippingAccountCodesPromise ??= loadAccountCodesById(this.database, {
      companyId: this.companyId,
      integration: this.provider.id
    }).catch((error) => {
      this.shippingAccountCodesPromise = undefined;
      throw error;
    });
    const code = (await this.shippingAccountCodesPromise).get(id);
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
    remoteUpdatedAt?: Date
  ): Promise<void> {
    // Use the mapping service to link invoice -> salesInvoice
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      "invoice",
      localId,
      this.provider.id,
      remoteId,
      {
        remoteUpdatedAt
      }
    );

    // Also update updatedAt on salesInvoice
    await tx
      .updateTable("salesInvoice")
      .set({
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", localId)
      .execute();
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
    const hasSales = document.components.some(
      (line) => line.kind !== "LineShipping" && line.kind !== "HeaderShipping"
    );
    const salesAccountCode = hasSales ? await this.getSalesAccountCode() : "";
    const shippingAccountCode = hasShipping
      ? await this.getShippingAccountCode(local)
      : null;
    const lineItems = buildXeroSalesInvoiceLines({
      document,
      salesAccountCode,
      shippingAccountCode
    });
    // All currency/account/component requirements are checked before dependency writes.
    const existingRemoteId = await this.getRemoteId(local.id);
    const customerRemoteId = await this.ensureDependencySynced(
      "customer",
      local.customerId
    );
    const itemIds = [
      ...new Set(
        document.components
          .filter((line) => line.kind === "Merchandise" && line.itemId)
          .map((line) => line.itemId!)
      )
    ];
    for (const itemId of itemIds)
      await this.ensureDependencySynced("item", itemId);
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
      dateIssued: remote.Date ?? null,
      dateDue: remote.DueDate ?? null,
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
        existingRemoteId ? "update invoice" : "create invoice",
        result
      );
    }

    if (!result.data?.Invoices?.[0]?.InvoiceID) {
      throw new Error(
        "Xero API returned success but no InvoiceID was returned"
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
      throwXeroApiError("batch upsert invoices", response);
    }

    if (!response.data?.Invoices) {
      throw new Error(
        "Xero API returned success but no Invoices array was returned"
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

    return true;
  }
}
