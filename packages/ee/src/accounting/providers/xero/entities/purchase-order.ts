// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { KyselyTx } from "@carbon/database/client";
import { distributeRoundingResidual } from "@carbon/utils";
import { createMappingService } from "../../../core/external-mapping";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";
import {
  hasXeroMappedTax,
  resolveXeroTaxType,
  verifiedXeroAccountCode,
  XeroTaxContextLoader
} from "../tax";
import { xeroItemCode } from "./item";

// Note: This syncer uses the default ID mapping from BaseEntitySyncer
// which uses the externalIntegrationMapping table with entityType "purchaseOrder"

// Type for rows returned from purchaseOrder queries
type PurchaseOrderRow = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  supplierId: string;
  status:
    | "Draft"
    | "Needs Approval"
    | "To Review"
    | "Rejected"
    | "To Receive"
    | "To Receive and Invoice"
    | "To Invoice"
    | "Completed"
    | "Closed"
    | "Planned";
  orderDate: string | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  supplierReference: string | null;
  currencyDecimalPlaces: number | null;
  updatedAt: string | null;
};

// Type for rows returned from purchaseOrderLine queries. Amounts are the
// supplier's (the order currency), never the base-currency columns.
type PurchaseOrderLineRow = {
  id: string;
  purchaseOrderId: string;
  description: string | null;
  purchaseQuantity: number | null;
  supplierUnitPrice: number | null;
  itemId: string | null;
  accountId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  supplierTaxAmount: number | null;
  taxCodeId: string | null;
  supplierShippingCost: number | null;
  supplierExtendedPrice: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  itemReadableId: string | null;
  itemReadableIdWithRevision: string | null;
};

/** A purchase order line with the tax code and the shipping its tax covers.
 *  Amounts are in the order's currency. */
export type XeroPurchaseOrderLine = Accounting.PurchaseOrderLine & {
  taxCodeId: string | null;
  /** Taxed with the line (`taxAmount` is on price × quantity + shipping). */
  shippingCost: number;
};

/** The purchase order a Xero purchase order is built from. */
export type XeroPurchaseOrder = Omit<Accounting.PurchaseOrder, "lines"> & {
  lines: XeroPurchaseOrderLine[];
  /** The order currency's decimals, for the tax-amount check. */
  currencyDecimalPlaces: number | null;
};

/** One Xero line of a PO line (its goods or its shipping), with its tax. */
export type XeroPurchaseOrderLinePart = {
  shipping: boolean;
  taxCodeId: string | null;
  taxPercent: number;
  netAmount: number;
  taxAmount: number;
};

/**
 * The Xero lines of one PO line: the goods (quantity × unit price), then its
 * shipping as a line of its own, so each line's tax is on its own
 * `LineAmount`. The line's tax covers both: each part starts at its net ×
 * rate and the leftover goes one minor unit per part. A tax the rate cannot
 * explain is split in proportion to net, and the tax check refuses it.
 * Pure — exported for tests.
 */
export function xeroPurchaseOrderLineParts(
  line: XeroPurchaseOrderLine,
  decimalPlaces: number | null
): XeroPurchaseOrderLinePart[] {
  const tax = { taxCodeId: line.taxCodeId, taxPercent: line.taxPercent ?? 0 };
  const taxAmount = line.taxAmount ?? 0;
  const goods = line.totalAmount;
  const shipping = line.shippingCost;
  if (shipping === 0) {
    return [{ shipping: false, ...tax, netAmount: goods, taxAmount }];
  }
  let split = [taxAmount, 0];
  if (taxAmount !== 0) {
    if (decimalPlaces === null) {
      throw new Error(
        `Purchase order line ${line.id} taxes its shipping but its currency has no decimal places`
      );
    }
    try {
      split = distributeRoundingResidual(
        [goods * tax.taxPercent, shipping * tax.taxPercent],
        taxAmount,
        decimalPlaces
      );
    } catch {
      const net = goods + shipping;
      split =
        net === 0
          ? split
          : distributeRoundingResidual(
              [(taxAmount * goods) / net, (taxAmount * shipping) / net],
              taxAmount,
              decimalPlaces
            );
    }
  }
  return [
    { shipping: false, ...tax, netAmount: goods, taxAmount: split[0]! },
    { shipping: true, ...tax, netAmount: shipping, taxAmount: split[1]! }
  ];
}

// Status mapping between Carbon and Xero
const CARBON_TO_XERO_STATUS: Record<
  PurchaseOrderRow["status"],
  Xero.PurchaseOrder["Status"]
> = {
  Draft: "DRAFT",
  "Needs Approval": "SUBMITTED",
  "To Review": "SUBMITTED",
  Rejected: "DRAFT",
  Planned: "DRAFT",
  "To Receive": "AUTHORISED",
  "To Receive and Invoice": "AUTHORISED",
  "To Invoice": "BILLED",
  Completed: "BILLED",
  Closed: "BILLED"
};

const XERO_TO_CARBON_STATUS: Record<
  Xero.PurchaseOrder["Status"],
  Accounting.PurchaseOrder["status"]
> = {
  DRAFT: "Draft",
  SUBMITTED: "To Review",
  AUTHORISED: "To Receive",
  BILLED: "To Invoice",
  DELETED: "Closed"
};

export class PurchaseOrderSyncer extends BaseEntitySyncer<
  XeroPurchaseOrder,
  Xero.PurchaseOrder,
  "UpdatedDateUTC"
> {
  private readonly taxContext = new XeroTaxContextLoader(
    this.database,
    { companyId: this.companyId, integration: this.provider.id },
    this.provider as XeroProvider
  );

  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  // =================================================================
  // 1. ID MAPPING - Uses default implementation from BaseEntitySyncer
  // The entityType "purchaseOrder" maps to the purchaseOrder table
  // =================================================================

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.PurchaseOrder): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<XeroPurchaseOrder | null> {
    const orders = await this.fetchOrdersByIds([id]);
    return orders.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, XeroPurchaseOrder>> {
    if (ids.length === 0) return new Map();
    return this.fetchOrdersByIds(ids);
  }

  private async fetchOrdersByIds(
    ids: string[]
  ): Promise<Map<string, XeroPurchaseOrder>> {
    if (ids.length === 0) return new Map();

    // Fetch purchase orders
    const orderRows = await this.database
      .selectFrom("purchaseOrder")
      .innerJoin("company", "company.id", "purchaseOrder.companyId")
      .leftJoin("currency", (join) =>
        join
          .onRef("currency.code", "=", "purchaseOrder.currencyCode")
          .onRef("currency.companyGroupId", "=", "company.companyGroupId")
      )
      .select([
        "purchaseOrder.id",
        "purchaseOrder.companyId",
        "purchaseOrder.purchaseOrderId",
        "purchaseOrder.supplierId",
        "purchaseOrder.status",
        "purchaseOrder.orderDate",
        "purchaseOrder.currencyCode",
        "purchaseOrder.exchangeRate",
        "purchaseOrder.supplierReference",
        "purchaseOrder.updatedAt",
        "currency.decimalPlaces as currencyDecimalPlaces"
      ])
      .where("purchaseOrder.id", "in", ids)
      .where("purchaseOrder.companyId", "=", this.companyId)
      .execute();

    if (orderRows.length === 0) return new Map();

    // Fetch lines for all orders
    const orderIds = orderRows.map((o) => o.id);
    const lineRows = await this.database
      .selectFrom("purchaseOrderLine")
      .leftJoin("item", "item.id", "purchaseOrderLine.itemId")
      .leftJoin("account", "account.id", "purchaseOrderLine.accountId")
      .select([
        "purchaseOrderLine.id",
        "purchaseOrderLine.purchaseOrderId",
        "purchaseOrderLine.description",
        "purchaseOrderLine.purchaseQuantity",
        "purchaseOrderLine.supplierUnitPrice",
        "purchaseOrderLine.itemId",
        "purchaseOrderLine.accountId",
        "purchaseOrderLine.taxPercent",
        "purchaseOrderLine.supplierTaxAmount",
        "purchaseOrderLine.taxCodeId",
        "purchaseOrderLine.supplierShippingCost",
        "purchaseOrderLine.supplierExtendedPrice",
        "purchaseOrderLine.quantityReceived",
        "purchaseOrderLine.quantityInvoiced",
        "item.readableId as itemReadableId",
        "item.readableIdWithRevision as itemReadableIdWithRevision",
        "account.number as accountNumber"
      ])
      .where("purchaseOrderLine.purchaseOrderId", "in", orderIds)
      .execute();

    // Fetch supplier external IDs for mapping via the mapping service
    const supplierIds = orderRows.map((o) => o.supplierId);
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

    // Group lines by order
    const linesByOrder = new Map<string, PurchaseOrderLineRow[]>();
    for (const line of lineRows) {
      const existing = linesByOrder.get(line.purchaseOrderId) ?? [];
      existing.push(line as PurchaseOrderLineRow);
      linesByOrder.set(line.purchaseOrderId, existing);
    }

    // Calculate totals and transform to XeroPurchaseOrder
    const result = new Map<string, XeroPurchaseOrder>();
    for (const row of orderRows) {
      const lines = linesByOrder.get(row.id) ?? [];

      // Calculate totals from lines (parse to numbers since NUMERIC comes as strings)
      let subtotal = 0;
      let totalTax = 0;
      for (const line of lines) {
        subtotal +=
          (Number(line.supplierExtendedPrice) || 0) +
          (Number(line.supplierShippingCost) || 0);
        totalTax += Number(line.supplierTaxAmount) || 0;
      }

      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        purchaseOrderId: row.purchaseOrderId,
        supplierId: row.supplierId,
        supplierExternalId: supplierExternalIds.get(row.supplierId) ?? null,
        status: row.status,
        orderDate: row.orderDate,
        deliveryDate: null, // Would need to join purchaseOrderDelivery
        deliveryAddress: null,
        deliveryInstructions: null,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        subtotal,
        totalTax,
        totalAmount: subtotal + totalTax,
        supplierReference: row.supplierReference,
        currencyDecimalPlaces:
          row.currencyDecimalPlaces == null
            ? null
            : Number(row.currencyDecimalPlaces),
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: Number(line.purchaseQuantity) || 0,
          unitPrice: Number(line.supplierUnitPrice) || 0,
          itemId: line.itemId,
          itemCode: line.itemReadableId
            ? xeroItemCode({
                readableId: line.itemReadableId,
                readableIdWithRevision: line.itemReadableIdWithRevision
              })
            : null,
          accountId: line.accountId,
          accountNumber: line.accountNumber,
          taxPercent: line.taxPercent != null ? Number(line.taxPercent) : null,
          taxAmount:
            line.supplierTaxAmount != null
              ? Number(line.supplierTaxAmount)
              : null,
          taxCodeId: line.taxCodeId,
          shippingCost: Number(line.supplierShippingCost) || 0,
          totalAmount: Number(line.supplierExtendedPrice) || 0,
          quantityReceived:
            line.quantityReceived != null
              ? Number(line.quantityReceived)
              : null,
          quantityInvoiced:
            line.quantityInvoiced != null ? Number(line.quantityInvoiced) : null
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

  async fetchRemote(id: string): Promise<Xero.PurchaseOrder | null> {
    const result = await this.xeroProvider.request<{
      PurchaseOrders: Xero.PurchaseOrder[];
    }>("GET", `/PurchaseOrders/${id}`);

    if (result.error) return null;

    const data = result.data as
      | { PurchaseOrders: Xero.PurchaseOrder[] }
      | undefined;
    return data?.PurchaseOrders?.[0] ?? null;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.PurchaseOrder>> {
    const result = new Map<string, Xero.PurchaseOrder>();
    if (ids.length === 0) return result;

    const response = await this.xeroProvider.request<{
      PurchaseOrders: Xero.PurchaseOrder[];
    }>("GET", `/PurchaseOrders?IDs=${ids.join(",")}`);

    if (response.error) {
      throwXeroApiError("fetch purchase orders batch", response);
    }

    const data = response.data as
      | { PurchaseOrders: Xero.PurchaseOrder[] }
      | undefined;
    for (const po of data?.PurchaseOrders ?? []) {
      result.set(po.PurchaseOrderID, po);
    }

    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: XeroPurchaseOrder
  ): Promise<Omit<Xero.PurchaseOrder, "UpdatedDateUTC">> {
    const existingRemoteId = await this.getRemoteId(local.id);

    // Resolve every line's tax before any dependency write, so an
    // UNMAPPED_TAX_CODES Warning provisions nothing in Xero.
    // A Reverse Charge line goes out at NONE (Phase 1, as bills do).
    const lineParts = local.lines.map((line) =>
      xeroPurchaseOrderLineParts(line, local.currencyDecimalPlaces)
    );
    const taxContext = await this.taxContext.forLines(
      "purchase",
      lineParts.flat()
    );
    const accountCodesById = taxContext.catalogLoaded
      ? await this.taxContext.accountCodesById()
      : new Map<string, string>();
    const taxTypes = lineParts.map((parts, index) =>
      parts.map((part) =>
        resolveXeroTaxType({
          context: taxContext,
          documentId: local.id,
          direction: "purchase",
          taxCodeId: part.taxCodeId,
          taxPercent: part.taxPercent,
          netAmount: part.netAmount,
          taxAmount: part.taxAmount,
          decimalPlaces: local.currencyDecimalPlaces,
          accountCode: verifiedXeroAccountCode(
            local.lines[index]!,
            accountCodesById
          )
        })
      )
    );

    // Get supplier's Xero ContactID - ensure supplier is synced first
    let contactId = local.supplierExternalId;
    if (!contactId && local.supplierId) {
      contactId = await this.ensureDependencySynced("vendor", local.supplierId);
    }

    if (!contactId) {
      throw new Error(
        `Cannot sync PO ${local.id}: No supplier linked or supplier not synced to Xero`
      );
    }

    // Map line items: each PO line, then its shipping on a line of its own.
    const lineItemGroups: Xero.PurchaseOrderLineItem[][] = await Promise.all(
      local.lines.map(async (line, index) => {
        let itemCode = line.itemCode;

        // If line has an item, ensure it's synced to Xero first
        if (line.itemId) {
          await this.ensureDependencySynced("item", line.itemId);
          // If we don't have the itemCode, fetch it from the item table
          if (!itemCode) {
            const item = await this.database
              .selectFrom("item")
              .select(["readableId", "readableIdWithRevision"])
              .where("id", "=", line.itemId)
              .executeTakeFirst();
            itemCode = item ? xeroItemCode(item) : null;
          }
        }

        // PO is non-posting — Xero accepts PO lines without AccountCode, so
        // only send one when the line actually carries an account number
        // (no blunt default-account-code fallback).
        const accountCode = line.accountNumber ?? undefined;
        return lineParts[index]!.map((part, partIndex) => ({
          ...(part.shipping
            ? {
                Description: line.description
                  ? `Shipping: ${line.description}`
                  : "Shipping",
                Quantity: 1,
                UnitAmount: part.netAmount
              }
            : {
                Description: line.description ?? undefined,
                Quantity: line.quantity,
                UnitAmount: line.unitPrice,
                ItemCode: itemCode?.slice(0, 30) ?? undefined
              }),
          AccountCode: accountCode,
          TaxAmount: part.taxAmount,
          LineAmount: part.netAmount,
          // The mapped purchase rate; NONE for an untaxed legacy line.
          TaxType: taxTypes[index]![partIndex]
        }));
      })
    );
    const lineItems = lineItemGroups.flat();

    return {
      PurchaseOrderID: existingRemoteId!,
      PurchaseOrderNumber: local.purchaseOrderId,
      Reference: local.supplierReference ?? undefined,
      Contact: { ContactID: contactId },
      Date: local.orderDate ?? undefined,
      DeliveryDate: local.deliveryDate ?? undefined,
      DeliveryAddress: local.deliveryAddress ?? undefined,
      DeliveryInstructions: local.deliveryInstructions ?? undefined,
      Status: CARBON_TO_XERO_STATUS[local.status],
      CurrencyCode: local.currencyCode ?? undefined,
      CurrencyRate:
        local.exchangeRate && local.exchangeRate !== 1
          ? local.exchangeRate
          : undefined,
      // Lines with a mapped rate state amounts net of the tax they carry.
      ...(hasXeroMappedTax(lineItems)
        ? { LineAmountTypes: "Exclusive" as const }
        : {}),
      LineItems: lineItems,
      SubTotal: local.subtotal,
      TotalTax: local.totalTax,
      Total: local.totalAmount
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Xero.PurchaseOrder
  ): Promise<Partial<XeroPurchaseOrder>> {
    const status = XERO_TO_CARBON_STATUS[remote.Status];

    // Map line items
    const lines: XeroPurchaseOrderLine[] = (remote.LineItems ?? []).map(
      (line, index) => ({
        id: line.LineItemID ?? `temp-${index}`,
        description: line.Description ?? null,
        quantity: line.Quantity ?? 1,
        unitPrice: line.UnitAmount ?? 0,
        itemId: null, // Will be resolved during upsertLocal if ItemCode matches
        itemCode: line.ItemCode ?? null,
        accountNumber: line.AccountCode ?? null,
        taxPercent: null,
        taxAmount: line.TaxAmount ?? null,
        taxCodeId: null,
        shippingCost: 0,
        totalAmount: line.LineAmount ?? 0,
        quantityReceived: null,
        quantityInvoiced: null
      })
    );

    return {
      purchaseOrderId: remote.PurchaseOrderNumber ?? remote.PurchaseOrderID,
      supplierExternalId: remote.Contact.ContactID,
      status,
      orderDate: remote.Date ?? null,
      deliveryDate: remote.DeliveryDate ?? null,
      deliveryAddress: remote.DeliveryAddress ?? null,
      deliveryInstructions: remote.DeliveryInstructions ?? null,
      currencyCode: remote.CurrencyCode ?? "USD",
      exchangeRate: remote.CurrencyRate ?? 1,
      subtotal: remote.SubTotal ?? 0,
      totalTax: remote.TotalTax ?? 0,
      totalAmount: remote.Total ?? 0,
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
    data: Partial<XeroPurchaseOrder>,
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
      // Update existing purchase order (mapping is handled by linkEntities in base class)
      await tx
        .updateTable("purchaseOrder")
        .set({
          supplierId: supplierId ?? undefined,
          status: data.status,
          orderDate: data.orderDate,
          currencyCode: data.currencyCode,
          exchangeRate: data.exchangeRate,
          supplierReference: data.supplierReference,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingLocalId)
        .where("companyId", "=", this.companyId)
        .execute();

      // Update lines
      await this.upsertLines(tx, existingLocalId, data.lines ?? []);

      return existingLocalId;
    }

    // For new POs from Xero, we need to create them
    // This requires more context (supplierInteractionId, createdBy, etc.)
    throw new Error(
      `Cannot create new purchase order from Xero. PO with ID ${remoteId} must be created in Carbon first and then synced.`
    );
  }

  private async upsertLines(
    tx: KyselyTx,
    purchaseOrderId: string,
    lines: Accounting.PurchaseOrderLine[]
  ): Promise<void> {
    // Delete existing lines
    await tx
      .deleteFrom("purchaseOrderLine")
      .where("purchaseOrderId", "=", purchaseOrderId)
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

    // Get the PO to get companyId and createdBy
    const po = await tx
      .selectFrom("purchaseOrder")
      .select(["companyId", "createdBy", "exchangeRate"])
      .where("id", "=", purchaseOrderId)
      .executeTakeFirstOrThrow();

    // Insert new lines
    for (const line of lines) {
      const itemId = line.itemCode
        ? (itemMap.get(line.itemCode) ?? null)
        : null;

      await tx
        .insertInto("purchaseOrderLine")
        .values({
          purchaseOrderId,
          companyId: po.companyId,
          createdBy: po.createdBy,
          description: line.description,
          purchaseQuantity: line.quantity,
          unitPrice: line.unitPrice,
          supplierUnitPrice: line.unitPrice,
          itemId,
          accountId: line.accountNumber
            ? (accountIdMap.get(line.accountNumber) ?? null)
            : null,
          taxPercent: line.taxPercent,
          taxAmount: line.taxAmount,
          supplierTaxAmount: line.taxAmount ?? 0,
          extendedPrice: line.totalAmount,
          supplierExtendedPrice: line.totalAmount,
          exchangeRate: po.exchangeRate ?? 1,
          purchaseOrderLineType: itemId ? "Part" : "G/L Account",
          supplierShippingCost: 0,
          invoicedComplete: false,
          receivedComplete: false
        })
        .execute();
    }
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.PurchaseOrder, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);
    const purchaseOrders = existingRemoteId
      ? [{ ...data, PurchaseOrderID: existingRemoteId }]
      : [data];

    const result = await this.xeroProvider.request<{
      PurchaseOrders: Xero.PurchaseOrder[];
    }>("POST", "/PurchaseOrders", {
      body: JSON.stringify({ PurchaseOrders: purchaseOrders })
    });

    if (result.error) {
      throwXeroApiError(
        existingRemoteId ? "update purchase order" : "create purchase order",
        result
      );
    }

    const resData = result.data as
      | { PurchaseOrders: Xero.PurchaseOrder[] }
      | undefined;
    const poId = resData?.PurchaseOrders?.[0]?.PurchaseOrderID;

    if (!poId) {
      throw new Error(
        "Xero API returned success but no PurchaseOrderID was returned"
      );
    }

    return poId;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.PurchaseOrder, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (data.length === 0) return result;

    const purchaseOrders: Xero.PurchaseOrder[] = [];
    const localIdOrder: string[] = [];

    for (const { localId, payload } of data) {
      const existingRemoteId = await this.getRemoteId(localId);
      purchaseOrders.push(
        existingRemoteId
          ? ({
              ...payload,
              PurchaseOrderID: existingRemoteId
            } as Xero.PurchaseOrder)
          : (payload as Xero.PurchaseOrder)
      );
      localIdOrder.push(localId);
    }

    const response = await this.xeroProvider.request<{
      PurchaseOrders: Xero.PurchaseOrder[];
    }>("POST", "/PurchaseOrders", {
      body: JSON.stringify({ PurchaseOrders: purchaseOrders })
    });

    if (response.error) {
      throwXeroApiError("batch upsert purchase orders", response);
    }

    if (!response.data?.PurchaseOrders) {
      throw new Error(
        "Xero API returned success but no PurchaseOrders array was returned"
      );
    }

    for (let i = 0; i < response.data.PurchaseOrders.length; i++) {
      const returnedPO = response.data.PurchaseOrders[i];
      const localId = localIdOrder[i];
      if (returnedPO?.PurchaseOrderID && localId) {
        result.set(localId, returnedPO.PurchaseOrderID);
      }
    }

    return result;
  }

  // =================================================================
  // 9. SHOULD SYNC: Only sync POs that are past Draft/Planned status
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<XeroPurchaseOrder, Xero.PurchaseOrder>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      // Only sync POs in locked statuses (finalized and receiving/invoicing)
      const syncableStatuses: Accounting.PurchaseOrder["status"][] = [
        "To Receive",
        "To Receive and Invoice",
        "To Invoice",
        "Completed"
      ];
      if (!syncableStatuses.includes(context.localEntity.status)) {
        return `Purchase order must be in a locked status to sync (current: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
