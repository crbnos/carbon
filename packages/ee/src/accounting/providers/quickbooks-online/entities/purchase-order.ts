import type { KyselyTx } from "@carbon/database/client";
import { createMappingService } from "../../../core/external-mapping";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { parseQboDate, type Qbo } from "../models";
import type { QboProvider } from "../provider";
import {
  buildQboDocNumberFields,
  buildQboExpenseLines,
  loadQboAccountRefsById,
  type QboWriteOmit,
  updateWithSyncTokenRetry
} from "./shared";

/**
 * QboPurchaseOrderSyncer — Carbon purchase orders → QBO PurchaseOrder
 * objects (push-to-accounting, owner carbon per DEFAULT_SYNC_CONFIG;
 * entityType "purchaseOrder" like the Xero counterpart).
 *
 * Push: only POs in a locked status (same gate as the Xero counterpart).
 * VendorRef via JIT vendor sync, POEmail from the supplier's primary
 * contact, lines per the model (ItemBasedExpenseLineDetail for item lines,
 * AccountBasedExpenseLineDetail with the mapped account otherwise),
 * DocNumber under QBO's 21-char cap else PrivateNote. POStatus maps from
 * the Carbon status (Completed/Closed → Closed, else Open).
 *
 * Pull is update-only (dates/status back onto the Carbon PO) — POs are
 * never created from QBO, mirroring the Xero counterpart.
 */

// Only sync POs in locked statuses (behavior copied from the Xero syncer)
const SYNCABLE_STATUSES: Accounting.PurchaseOrder["status"][] = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed"
];

// Row shapes (mirror the Xero PO syncer's, plus line accountId for the
// account-mapping resolution QBO needs)
type PurchaseOrderRow = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  supplierId: string;
  status: Accounting.PurchaseOrder["status"];
  orderDate: string | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  supplierReference: string | null;
  updatedAt: string | null;
};

type PurchaseOrderLineRow = {
  id: string;
  purchaseOrderId: string;
  description: string | null;
  purchaseQuantity: number | null;
  unitPrice: number | null;
  itemId: string | null;
  accountId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  extendedPrice: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  itemCode: string | null;
};

/** Carbon PO status → QBO POStatus. Pure — exported for tests. */
export function mapCarbonPoStatusToQbo(
  status: Accounting.PurchaseOrder["status"]
): "Open" | "Closed" {
  return status === "Completed" || status === "Closed" ? "Closed" : "Open";
}

/** QBO POStatus → Carbon PO status. Pure — exported for tests. */
export function mapQboPoStatusToCarbon(
  status: "Open" | "Closed" | undefined
): Accounting.PurchaseOrder["status"] | undefined {
  if (!status) return undefined;
  return status === "Closed" ? "Closed" : "To Receive";
}

export class QboPurchaseOrderSyncer extends BaseEntitySyncer<
  Accounting.PurchaseOrder,
  Qbo.PurchaseOrder,
  QboWriteOmit
> {
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  private getAccountRefsById(): Promise<Map<string, Qbo.Ref>> {
    if (!this.accountRefsByIdPromise) {
      this.accountRefsByIdPromise = loadQboAccountRefsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountRefsByIdPromise;
  }

  // =================================================================
  // 1. ID MAPPING — default implementation (entityType "purchaseOrder")
  // =================================================================

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Qbo.PurchaseOrder): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.PurchaseOrder | null> {
    const orders = await this.fetchOrdersByIds([id]);
    return orders.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.PurchaseOrder>> {
    return this.fetchOrdersByIds(ids);
  }

  private async fetchOrdersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.PurchaseOrder>> {
    if (ids.length === 0) return new Map();

    const orderRows = await this.database
      .selectFrom("purchaseOrder")
      .select([
        "id",
        "companyId",
        "purchaseOrderId",
        "supplierId",
        "status",
        "orderDate",
        "currencyCode",
        "exchangeRate",
        "supplierReference",
        "updatedAt"
      ])
      .where("id", "in", ids)
      .where("companyId", "=", this.companyId)
      .execute();

    if (orderRows.length === 0) return new Map();

    const lineRows = await this.database
      .selectFrom("purchaseOrderLine")
      .leftJoin("item", "item.id", "purchaseOrderLine.itemId")
      .leftJoin("account", "account.id", "purchaseOrderLine.accountId")
      .select([
        "purchaseOrderLine.id",
        "purchaseOrderLine.purchaseOrderId",
        "purchaseOrderLine.description",
        "purchaseOrderLine.purchaseQuantity",
        "purchaseOrderLine.unitPrice",
        "purchaseOrderLine.itemId",
        "purchaseOrderLine.accountId",
        "purchaseOrderLine.taxPercent",
        "purchaseOrderLine.taxAmount",
        "purchaseOrderLine.extendedPrice",
        "purchaseOrderLine.quantityReceived",
        "purchaseOrderLine.quantityInvoiced",
        "item.readableId as itemCode",
        "account.number as accountNumber"
      ])
      .where(
        "purchaseOrderLine.purchaseOrderId",
        "in",
        orderRows.map((o) => o.id)
      )
      .execute();

    // Supplier external IDs (entityType "vendor" — what the vendor syncer
    // stores)
    const supplierExternalIds = new Map<string, string | null>();
    const mappingService = createMappingService(this.database, this.companyId);
    for (const row of orderRows) {
      if (!supplierExternalIds.has(row.supplierId)) {
        supplierExternalIds.set(
          row.supplierId,
          await mappingService.getExternalId(
            "vendor",
            row.supplierId,
            this.provider.id
          )
        );
      }
    }

    const linesByOrder = new Map<string, PurchaseOrderLineRow[]>();
    for (const line of lineRows as PurchaseOrderLineRow[]) {
      const existing = linesByOrder.get(line.purchaseOrderId) ?? [];
      existing.push(line);
      linesByOrder.set(line.purchaseOrderId, existing);
    }

    const result = new Map<string, Accounting.PurchaseOrder>();
    for (const row of orderRows as PurchaseOrderRow[]) {
      const lines = linesByOrder.get(row.id) ?? [];

      let subtotal = 0;
      let totalTax = 0;
      for (const line of lines) {
        subtotal += Number(line.extendedPrice) || 0;
        totalTax += Number(line.taxAmount) || 0;
      }

      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        purchaseOrderId: row.purchaseOrderId,
        supplierId: row.supplierId,
        supplierExternalId: supplierExternalIds.get(row.supplierId) ?? null,
        status: row.status,
        orderDate: row.orderDate,
        deliveryDate: null,
        deliveryAddress: null,
        deliveryInstructions: null,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        subtotal,
        totalTax,
        totalAmount: subtotal + totalTax,
        supplierReference: row.supplierReference,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: Number(line.purchaseQuantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          itemId: line.itemId,
          itemCode: line.itemCode,
          accountId: line.accountId,
          accountNumber: line.accountNumber,
          taxPercent: line.taxPercent != null ? Number(line.taxPercent) : null,
          taxAmount: line.taxAmount != null ? Number(line.taxAmount) : null,
          totalAmount: Number(line.extendedPrice) || 0,
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

  async fetchRemote(id: string): Promise<Qbo.PurchaseOrder | null> {
    return this.qboProvider.getPurchaseOrder(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.PurchaseOrder>> {
    const result = new Map<string, Qbo.PurchaseOrder>();
    for (const id of ids) {
      const purchaseOrder = await this.fetchRemote(id);
      if (purchaseOrder) result.set(purchaseOrder.Id, purchaseOrder);
    }
    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.PurchaseOrder
  ): Promise<Omit<Qbo.PurchaseOrder, QboWriteOmit>> {
    // JIT dependency: vendor before the document
    let vendorRemoteId = local.supplierExternalId;
    if (!vendorRemoteId && local.supplierId) {
      vendorRemoteId = await this.ensureDependencySynced(
        "vendor",
        local.supplierId
      );
    }

    if (!vendorRemoteId) {
      throw new Error(
        `Cannot sync PO ${local.id}: No supplier linked or supplier not synced to QuickBooks Online`
      );
    }

    // JIT dependencies: line items before the document
    const itemRemoteIds = new Map<string, string>();
    for (const line of local.lines) {
      if (line.itemId && !itemRemoteIds.has(line.itemId)) {
        itemRemoteIds.set(
          line.itemId,
          await this.ensureDependencySynced("item", line.itemId)
        );
      }
    }

    const accountRefsById = await this.getAccountRefsById();
    const supplierEmail = await this.getSupplierEmail(local.supplierId);

    const docNumber = buildQboDocNumberFields(
      local.purchaseOrderId,
      local.supplierReference ? `Ref ${local.supplierReference}` : undefined
    );

    return {
      DocNumber: docNumber.DocNumber,
      PrivateNote: docNumber.PrivateNote,
      TxnDate: local.orderDate ?? undefined,
      VendorRef: { value: vendorRemoteId },
      POEmail: supplierEmail ? { Address: supplierEmail } : undefined,
      POStatus: mapCarbonPoStatusToQbo(local.status),
      Line: buildQboExpenseLines({
        lines: local.lines,
        itemRemoteIds,
        accountRefsById,
        documentLabel: `purchase order ${local.purchaseOrderId}`
      })
    };
  }

  /** Email of the supplier's first linked contact (for POEmail). */
  private async getSupplierEmail(supplierId: string): Promise<string | null> {
    const row = await this.database
      .selectFrom("supplierContact")
      .innerJoin("contact", "contact.id", "supplierContact.contactId")
      .select("contact.email")
      .where("supplierContact.supplierId", "=", supplierId)
      .executeTakeFirst();

    return row?.email ?? null;
  }

  // =================================================================
  // 6. TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Qbo.PurchaseOrder
  ): Promise<Partial<Accounting.PurchaseOrder>> {
    return {
      purchaseOrderId: remote.DocNumber ?? remote.Id,
      supplierExternalId: remote.VendorRef.value,
      status: mapQboPoStatusToCarbon(remote.POStatus),
      orderDate: remote.TxnDate ?? null,
      totalAmount: remote.TotalAmt ?? 0,
      updatedAt:
        parseQboDate(remote.MetaData?.LastUpdatedTime)?.toISOString() ??
        new Date().toISOString()
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL (Update existing only — Xero parity)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.PurchaseOrder>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new purchase order from QuickBooks Online. PO with ID ${remoteId} must be created in Carbon first and then synced.`
      );
    }

    await tx
      .updateTable("purchaseOrder")
      .set({
        status: data.status,
        orderDate: data.orderDate,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", existingLocalId)
      .where("companyId", "=", this.companyId)
      .execute();

    return existingLocalId;
  }

  // =================================================================
  // 8. UPSERT REMOTE (create, or sparse update with SyncToken retry)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Qbo.PurchaseOrder, QboWriteOmit>,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (!existingRemoteId) {
      const created = await this.qboProvider.createPurchaseOrder(data);
      return created.Id;
    }

    const updated = await updateWithSyncTokenRetry({
      entityLabel: "purchase order",
      remoteId: existingRemoteId,
      fetchCurrent: () => this.qboProvider.getPurchaseOrder(existingRemoteId),
      update: (syncToken) =>
        this.qboProvider.updatePurchaseOrder({
          ...data,
          Id: existingRemoteId,
          SyncToken: syncToken
        })
    });
    return updated.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Qbo.PurchaseOrder, QboWriteOmit>;
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
    context: ShouldSyncContext<Accounting.PurchaseOrder, Qbo.PurchaseOrder>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Purchase order must be in a locked status to sync (current: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
