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
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";

// Note: This syncer uses the default ID mapping from BaseEntitySyncer
// which uses the externalIntegrationMapping table with entityType "invoice"

// Type for rows returned from sales invoice queries with line joins
type InvoiceRow = {
  id: string;
  invoiceId: string;
  companyId: string;
  customerId: string;
  status:
    | "Draft"
    | "Pending"
    | "Submitted"
    | "Partially Paid"
    | "Paid"
    | "Overdue"
    | "Voided"
    | "Credit Note Issued"
    | "Return";
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
  // For item code lookup
  itemReadableIdWithRevision: string | null;
};

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
    return {
      Description: component.description,
      Quantity: component.quantity,
      UnitAmount: component.unitAmount,
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
  private shippingAccountCodePromise?: Promise<string>;

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

  private getShippingAccountCode(): Promise<string> {
    if (!this.shippingAccountCodePromise)
      this.shippingAccountCodePromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select("salesShippingRevenueAccount")
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();
        const accountId = defaults?.salesShippingRevenueAccount;
        const account = accountId
          ? await this.database
              .selectFrom("account as a")
              .innerJoin("company as c", "c.companyGroupId", "a.companyGroupId")
              .select(["a.id", "a.class", "a.active", "a.isGroup"])
              .where("c.id", "=", this.companyId)
              .where("a.id", "=", accountId)
              .executeTakeFirst()
          : undefined;
        if (
          !account ||
          account.class !== "Revenue" ||
          !account.active ||
          account.isGroup
        ) {
          throw new JournalEntrySyncError({
            errorCode: "UNMAPPED_ACCOUNTS",
            warning: true,
            message:
              "Cannot sync invoice: Shipping Revenue requires an active Revenue leaf in the company group",
            metadata: {
              missingDefaults: ["salesShippingRevenueAccount"],
              accountId
            }
          });
        }
        const mappings = await loadAccountCodesById(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        const code = mappings.get(accountId!);
        if (!code)
          throw new JournalEntrySyncError({
            errorCode: "UNMAPPED_ACCOUNTS",
            warning: true,
            message:
              "Cannot sync invoice: Shipping Revenue has no Xero account mapping",
            metadata: { unmappedAccountIds: [accountId] }
          });
        return code;
      })();
    return this.shippingAccountCodePromise;
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

  private async fetchInvoicesByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    if (ids.length === 0) return new Map();

    // Fetch invoice headers
    const invoiceRows = await this.database
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

    // Fetch invoice lines with item codes
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

    // Group lines by invoice ID
    const linesByInvoiceId = new Map<string, InvoiceLineRow[]>();
    for (const line of lineRows as InvoiceLineRow[]) {
      const existing = linesByInvoiceId.get(line.invoiceId) ?? [];
      existing.push(line);
      linesByInvoiceId.set(line.invoiceId, existing);
    }

    // Transform to Accounting.SalesInvoice
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
        customerExternalId: null, // Will be resolved during mapToRemote
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
      ? await this.getShippingAccountCode()
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
      // Xero's CurrencyRate is [invoice currency] PER [base currency] -- the
      // same direction Carbon stores exchangeRate in, so it passes through
      // unchanged. Inverting it earns Xero's "inverse rate" warning and books
      // the base amounts wrong. Omit it on base-currency invoices: Xero calls
      // an explicit rate of 1 redundant and warns on a 1 that reaches an FX
      // document.
      CurrencyRate: local.exchangeRate !== 1 ? local.exchangeRate : undefined
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
    }>("POST", "/Invoices", { body: JSON.stringify({ Invoices: invoices }) });

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
    }>("POST", "/Invoices", { body: JSON.stringify({ Invoices: invoices }) });

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
