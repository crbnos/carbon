import type { KyselyTx } from "@carbon/database/client";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";

// Note: This is a push-only syncer (Carbon -> Xero).
// Carbon sales orders are pushed as Xero Quotes since Xero
// has no dedicated sales order endpoint.

// Type for rows returned from salesOrder queries
type SalesOrderRow = {
  id: string;
  salesOrderId: string;
  companyId: string;
  customerId: string;
  status:
    | "Draft"
    | "Needs Approval"
    | "Confirmed"
    | "In Progress"
    | "To Ship and Invoice"
    | "To Ship"
    | "To Invoice"
    | "Completed"
    | "Invoiced"
    | "Cancelled"
    | "Closed";
  orderDate: string | null;
  currencyCode: string;
  exchangeRate: number;
  customerReference: string | null;
  updatedAt: string | null;
};

// Type for rows returned from salesOrderLine queries
type SalesOrderLineRow = {
  id: string;
  salesOrderId: string;
  salesOrderLineType: string;
  itemId: string | null;
  description: string | null;
  saleQuantity: number;
  unitPrice: number | null;
  setupPrice: number | null;
  accountNumber: string | null;
  itemReadableIdWithRevision: string | null;
};

// Status mapping: Carbon -> Xero Quote
const CARBON_TO_XERO_STATUS: Record<
  SalesOrderRow["status"],
  Xero.Quote["Status"]
> = {
  Draft: "DRAFT",
  "Needs Approval": "DRAFT",
  Confirmed: "ACCEPTED",
  "In Progress": "ACCEPTED",
  "To Ship and Invoice": "ACCEPTED",
  "To Ship": "ACCEPTED",
  "To Invoice": "ACCEPTED",
  Completed: "ACCEPTED",
  Invoiced: "INVOICED",
  Cancelled: "DELETED",
  Closed: "ACCEPTED"
};

// Syncable statuses — only sync orders past Draft/Needs Approval/Cancelled
const SYNCABLE_STATUSES: SalesOrderRow["status"][] = [
  "Confirmed",
  "In Progress",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Completed",
  "Invoiced"
];

export class SalesOrderSyncer extends BaseEntitySyncer<
  Accounting.SalesOrder,
  Xero.Quote,
  "UpdatedDateUTC"
> {
  // =================================================================
  // 1. ID MAPPING - Uses default implementation from BaseEntitySyncer
  // =================================================================

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.Quote): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.SalesOrder | null> {
    const orders = await this.fetchOrdersByIds([id]);
    return orders.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesOrder>> {
    return this.fetchOrdersByIds(ids);
  }

  private async fetchOrdersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesOrder>> {
    if (ids.length === 0) return new Map();

    // Fetch order headers
    const orderRows = await this.database
      .selectFrom("salesOrder")
      .select([
        "salesOrder.id",
        "salesOrder.salesOrderId",
        "salesOrder.companyId",
        "salesOrder.customerId",
        "salesOrder.status",
        "salesOrder.orderDate",
        "salesOrder.currencyCode",
        "salesOrder.exchangeRate",
        "salesOrder.customerReference",
        "salesOrder.updatedAt"
      ])
      .where("salesOrder.id", "in", ids)
      .where("salesOrder.companyId", "=", this.companyId)
      .execute();

    if (orderRows.length === 0) return new Map();

    // Fetch order lines with item codes
    const lineRows = await this.database
      .selectFrom("salesOrderLine")
      .leftJoin("item", "item.id", "salesOrderLine.itemId")
      .select([
        "salesOrderLine.id",
        "salesOrderLine.salesOrderId",
        "salesOrderLine.salesOrderLineType",
        "salesOrderLine.itemId",
        "salesOrderLine.description",
        "salesOrderLine.saleQuantity",
        "salesOrderLine.unitPrice",
        "salesOrderLine.setupPrice",
        "salesOrderLine.accountNumber",
        "item.readableIdWithRevision as itemReadableIdWithRevision"
      ])
      .where(
        "salesOrderLine.salesOrderId",
        "in",
        orderRows.map((r) => r.id)
      )
      .execute();

    // Group lines by order ID
    const linesByOrderId = new Map<string, SalesOrderLineRow[]>();
    for (const line of lineRows as unknown as SalesOrderLineRow[]) {
      const existing = linesByOrderId.get(line.salesOrderId) ?? [];
      existing.push(line);
      linesByOrderId.set(line.salesOrderId, existing);
    }

    // Transform to Accounting.SalesOrder
    const result = new Map<string, Accounting.SalesOrder>();
    for (const row of orderRows as unknown as SalesOrderRow[]) {
      const lines = linesByOrderId.get(row.id) ?? [];

      result.set(row.id, {
        id: row.id,
        salesOrderId: row.salesOrderId,
        companyId: row.companyId,
        customerId: row.customerId,
        customerExternalId: null, // Will be resolved during mapToRemote
        status: row.status,
        orderDate: row.orderDate,
        currencyCode: row.currencyCode,
        exchangeRate: row.exchangeRate,
        customerReference: row.customerReference,
        lines: lines.map((line) => {
          const unitPrice = line.unitPrice ?? 0;
          const setupPrice = line.setupPrice ?? 0;
          const quantity = line.saleQuantity;
          return {
            id: line.id,
            salesOrderLineType: line.salesOrderLineType,
            itemId: line.itemId,
            itemCode: line.itemReadableIdWithRevision,
            description: line.description,
            quantity,
            unitPrice,
            setupPrice,
            accountNumber: line.accountNumber,
            lineAmount: quantity * unitPrice + setupPrice
          };
        }),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.Quote | null> {
    const result = await this.provider.request<{ Quotes: Xero.Quote[] }>(
      "GET",
      `/Quotes/${id}`
    );
    return result.error ? null : (result.data?.Quotes?.[0] ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.Quote>> {
    const result = new Map<string, Xero.Quote>();
    if (ids.length === 0) return result;

    const response = await this.provider.request<{ Quotes: Xero.Quote[] }>(
      "GET",
      `/Quotes?IDs=${ids.join(",")}`
    );

    if (response.error) {
      throwXeroApiError("fetch quotes batch", response);
    }

    if (response.data?.Quotes) {
      for (const quote of response.data.Quotes) {
        result.set(quote.QuoteID, quote);
      }
    }

    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.SalesOrder
  ): Promise<Omit<Xero.Quote, "UpdatedDateUTC">> {
    const existingRemoteId = await this.getRemoteId(local.id);

    // Resolve customer dependency — ensure customer is synced to Xero
    const customerRemoteId = await this.ensureDependencySynced(
      "customer",
      local.customerId
    );

    // Build line items, resolving item dependencies
    const lineItems: Xero.QuoteLineItem[] = [];
    for (const line of local.lines) {
      // Skip comment lines — they have no financial data
      if (line.salesOrderLineType === "Comment") {
        continue;
      }

      const lineItem: Xero.QuoteLineItem = {
        Description: line.description ?? undefined,
        Quantity: line.quantity,
        UnitAmount: line.unitPrice,
        AccountCode: line.accountNumber ?? undefined,
        LineAmount: line.lineAmount
      };

      // If line has an item, ensure it's synced and set ItemCode
      if (line.itemId) {
        await this.ensureDependencySynced("item", line.itemId);
        if (line.itemCode) {
          lineItem.ItemCode = line.itemCode.slice(0, 30);
        }
      }

      lineItems.push(lineItem);
    }

    return {
      QuoteID: existingRemoteId!,
      QuoteNumber: local.salesOrderId,
      Reference: local.customerReference ?? undefined,
      Contact: {
        ContactID: customerRemoteId
      },
      Date: local.orderDate ?? undefined,
      Status: CARBON_TO_XERO_STATUS[local.status],
      LineAmountTypes: "Exclusive",
      LineItems: lineItems,
      CurrencyCode: local.currencyCode,
      CurrencyRate: local.exchangeRate !== 1 ? local.exchangeRate : undefined,
      Title: `Sales Order ${local.salesOrderId}`
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon) - Not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Xero.Quote
  ): Promise<Partial<Accounting.SalesOrder>> {
    throw new Error(
      "Sales orders are push-only. Cannot map from Xero to Carbon."
    );
  }

  // =================================================================
  // 7. UPSERT LOCAL - Not supported (push-only)
  // =================================================================

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<Accounting.SalesOrder>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Sales orders are push-only. Cannot upsert locally from Xero."
    );
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.Quote, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    // Xero uses PUT for create, POST for update-or-create
    const method = existingRemoteId ? "POST" : "PUT";
    const quotes = existingRemoteId
      ? [{ ...data, QuoteID: existingRemoteId }]
      : [data];

    const result = await this.provider.request<{ Quotes: Xero.Quote[] }>(
      method,
      "/Quotes",
      { body: JSON.stringify({ Quotes: quotes }) }
    );

    if (result.error) {
      throwXeroApiError(
        existingRemoteId
          ? "update sales order quote"
          : "create sales order quote",
        result
      );
    }

    if (!result.data?.Quotes?.[0]?.QuoteID) {
      throw new Error("Xero API returned success but no QuoteID was returned");
    }

    return result.data.Quotes[0].QuoteID;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.Quote, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (data.length === 0) return result;

    const quotes: Xero.Quote[] = [];
    const localIdOrder: string[] = [];

    for (const { localId, payload } of data) {
      const existingRemoteId = await this.getRemoteId(localId);
      quotes.push(
        existingRemoteId
          ? ({ ...payload, QuoteID: existingRemoteId } as Xero.Quote)
          : (payload as Xero.Quote)
      );
      localIdOrder.push(localId);
    }

    const response = await this.provider.request<{ Quotes: Xero.Quote[] }>(
      "POST",
      "/Quotes",
      { body: JSON.stringify({ Quotes: quotes }) }
    );

    if (response.error) {
      throwXeroApiError("batch upsert sales order quotes", response);
    }

    if (!response.data?.Quotes) {
      throw new Error(
        "Xero API returned success but no Quotes array was returned"
      );
    }

    for (let i = 0; i < response.data.Quotes.length; i++) {
      const returnedQuote = response.data.Quotes[i];
      const localId = localIdOrder[i];
      if (returnedQuote?.QuoteID && localId) {
        result.set(localId, returnedQuote.QuoteID);
      }
    }

    return result;
  }

  // =================================================================
  // 9. SHOULD SYNC: Only sync orders past Draft/Needs Approval
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.SalesOrder, Xero.Quote>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Sales order must be confirmed before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
