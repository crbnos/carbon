/**
 * Carbon Learn — the one database surface the challenge checkers may touch.
 *
 * Checkers never hold a Supabase client. They take a `LearnReader`, which makes
 * them pure functions of "what the learner has in this company since they
 * started", and therefore testable without a database.
 *
 * House rules for every method here:
 *   - scope by `companyId` AND `createdAt >= scope.since`, always;
 *   - scope by `createdBy` too, except `suppliersCreatedSince` (see below);
 *   - newest first, so a checker can take the first match and be taking the
 *     most recent one;
 *   - batch child lookups with a single `.in(...)` — never a query per parent;
 *   - return `[]` / `{}` on error. A checker must never throw at a learner.
 */

import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("erp", "learn-checker-reader");

/**
 * A checker must never crash the page, so a failed read degrades to "no
 * records found" — but it is LOGGED. Swallowing these silently once cost an
 * afternoon: a JS Date leaking into a PostgREST filter returned a 400 that
 * looked exactly like a learner who had not done the work yet.
 */
function empty<T>(context: string, error: unknown): T[] {
  if (error) logger.error(`learn checker read failed: ${context}`, { error });
  return [];
}

/** Group child rows by a parent id, so a checker gets one count per parent. */
function tally<K extends string>(
  rows: Array<Record<K, string | null>>,
  key: K
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const parent = row[key] ?? "";
    if (!parent) continue;
    counts[parent] = (counts[parent] ?? 0) + 1;
  }
  return counts;
}

/**
 * `invite.permissions` is JSONB shaped `{ "<module>_<action>": [companyId] }`.
 * A non-empty array is not enough: an invitation raised in this company whose
 * grants all name a DIFFERENT company gives the new starter nothing here, and
 * counting it would pass the challenge on an invitation that grants no access.
 * `"0"` is the wildcard meaning every company.
 */
function countGrantedPermissions(
  permissions: unknown,
  companyId: string
): number {
  if (!permissions || typeof permissions !== "object") return 0;
  return Object.values(permissions as Record<string, unknown>).filter(
    (value) =>
      Array.isArray(value) && value.some((id) => id === companyId || id === "0")
  ).length;
}

export type ReaderScope = {
  companyId: string;
  userId: string;
  /** ISO instant the learner started the challenge. Nothing older counts. */
  since: string;
};

export type LearnItemRow = {
  id: string;
  readableId: string;
  name: string;
  type: string;
};

export type LearnPurchaseOrderRow = {
  id: string;
  /** The READABLE id (PO000001) — `id` above is the UUID rows join on. */
  purchaseOrderId: string;
  status: string;
  supplierId: string;
};

export type LearnPurchaseOrderLineRow = {
  /** The parent order's UUID, not its readable id. */
  purchaseOrderId: string;
  purchaseQuantity: number | null;
  purchaseOrderLineType: string;
};

export type LearnReceiptRow = {
  id: string;
  /** The READABLE id (RE000001). */
  receiptId: string;
  status: string;
  sourceDocument: string | null;
  /** The source document's UUID — for a PO receipt, `purchaseOrder.id`. */
  sourceDocumentId: string | null;
};

export type LearnReceiptLineRow = {
  receiptId: string;
  receivedQuantity: number;
};

export type LearnSupplierRow = {
  id: string;
  name: string;
  createdBy: string | null;
};

export type LearnSupplierQuoteRow = {
  id: string;
  status: string;
  supplierId: string;
};

export type LearnPurchaseInvoiceRow = {
  id: string;
  /** The READABLE id (PINV000001). */
  invoiceId: string;
  status: string;
};

export type LearnPaymentRow = {
  id: string;
  paymentId: string;
  /** `Receipt` is money in, `Disbursement` is money out to a supplier. */
  paymentType: string;
  status: string;
  supplierId: string | null;
};

export type LearnAccountingPeriodRow = {
  id: string;
  fiscalYear: number | null;
  periodNumber: number | null;
  /** `Open | Locked | Closed` — NOT the `status` column, which is Active/Inactive. */
  closeStatus: string;
};

export type LearnQuoteRow = {
  id: string;
  quoteId: string;
  status: string;
  /**
   * The only link a quote and its sales order actually share — `salesOrder`
   * has no `quoteId` column.
   */
  opportunityId: string | null;
};

export type LearnSalesOrderRow = {
  id: string;
  salesOrderId: string;
  status: string;
  customerId: string;
  opportunityId: string | null;
};

export type LearnShipmentRow = {
  id: string;
  shipmentId: string;
  status: string;
  customerId: string | null;
};

export type LearnSalesInvoiceRow = {
  id: string;
  invoiceId: string;
  status: string;
  customerId: string;
};

export type LearnItemLedgerRow = {
  id: string;
  entryType: string;
  quantity: number;
  itemId: string;
};

export type LearnStockTransferRow = {
  id: string;
  stockTransferId: string;
  status: string;
};

export type LearnInventoryCountRow = {
  id: string;
  inventoryCountId: string;
  status: string;
};

export type LearnJobRow = {
  id: string;
  jobId: string;
  status: string;
  quantityComplete: number;
};

export type LearnItemPlanningRow = {
  itemId: string;
  reorderingPolicy: string;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  maximumInventoryQuantity: number | null;
  demandAccumulationPeriod: number | null;
};

export type LearnNonConformanceRow = {
  id: string;
  nonConformanceId: string;
  name: string;
  status: string;
  closeDate: string | null;
};

export type LearnInspectionRow = {
  id: string;
  inspectionId: string;
  status: string | null;
};

export type LearnEmployeeTypeRow = {
  id: string;
  name: string;
};

export type LearnCustomFieldRow = {
  id: string;
  name: string;
  table: string;
  active: boolean;
};

export type LearnInviteRow = {
  id: string;
  email: string;
  role: string | null;
  permissionCount: number;
};

export interface LearnReader {
  itemsCreatedBy(scope: ReaderScope): Promise<LearnItemRow[]>;
  purchaseOrdersCreatedBy(scope: ReaderScope): Promise<LearnPurchaseOrderRow[]>;
  purchaseOrderLines(
    companyId: string,
    purchaseOrderIds: string[]
  ): Promise<LearnPurchaseOrderLineRow[]>;
  receiptsCreatedBy(scope: ReaderScope): Promise<LearnReceiptRow[]>;
  receiptLines(
    companyId: string,
    receiptIds: string[]
  ): Promise<LearnReceiptLineRow[]>;
  suppliersCreatedSince(scope: ReaderScope): Promise<LearnSupplierRow[]>;
  supplierQuotesCreatedBy(scope: ReaderScope): Promise<LearnSupplierQuoteRow[]>;
  supplierQuoteLineCount(
    companyId: string,
    supplierQuoteIds: string[]
  ): Promise<Record<string, number>>;

  // ---------------------------------------------------------------- accounting
  purchaseInvoicesCreatedBy(
    scope: ReaderScope
  ): Promise<LearnPurchaseInvoiceRow[]>;
  paymentsCreatedBy(scope: ReaderScope): Promise<LearnPaymentRow[]>;
  /**
   * Scoped by `closedBy` / `closedAt` rather than the usual created-by pair —
   * an accounting period is created by the fiscal-year setup, and what the
   * learner did is CLOSE one.
   */
  accountingPeriodsClosedBy(
    scope: ReaderScope
  ): Promise<LearnAccountingPeriodRow[]>;

  // --------------------------------------------------------------------- sales
  quotesCreatedBy(scope: ReaderScope): Promise<LearnQuoteRow[]>;
  quoteLineCount(
    companyId: string,
    quoteIds: string[]
  ): Promise<Record<string, number>>;
  salesOrdersCreatedBy(scope: ReaderScope): Promise<LearnSalesOrderRow[]>;
  shipmentsCreatedBy(scope: ReaderScope): Promise<LearnShipmentRow[]>;
  salesInvoicesCreatedBy(scope: ReaderScope): Promise<LearnSalesInvoiceRow[]>;

  // ----------------------------------------------------------------- inventory
  itemLedgerEntriesCreatedBy(scope: ReaderScope): Promise<LearnItemLedgerRow[]>;
  stockTransfersCreatedBy(scope: ReaderScope): Promise<LearnStockTransferRow[]>;
  inventoryCountsCreatedBy(
    scope: ReaderScope
  ): Promise<LearnInventoryCountRow[]>;
  inventoryCountLineCount(
    companyId: string,
    inventoryCountIds: string[]
  ): Promise<Record<string, number>>;

  // ---------------------------------------------------------------- production
  jobsCreatedBy(scope: ReaderScope): Promise<LearnJobRow[]>;
  jobOperationCount(
    companyId: string,
    jobIds: string[]
  ): Promise<Record<string, number>>;
  jobMaterialCount(
    companyId: string,
    jobIds: string[]
  ): Promise<Record<string, number>>;

  // ------------------------------------------------------------------ planning
  itemPlanningUpdatedBy(scope: ReaderScope): Promise<LearnItemPlanningRow[]>;
  /**
   * Deliberately NOT scoped by `createdBy`: an MRP run is what raises these,
   * and the run is the learner's doing even when the row is not.
   */
  purchaseOrderLinesForItems(
    scope: ReaderScope,
    itemIds: string[]
  ): Promise<Array<{ purchaseOrderId: string; itemId: string }>>;

  // ------------------------------------------------------------------- quality
  nonConformancesCreatedBy(
    scope: ReaderScope
  ): Promise<LearnNonConformanceRow[]>;
  inspectionsCreatedBy(scope: ReaderScope): Promise<LearnInspectionRow[]>;

  // --------------------------------------------------------------------- admin
  /** `employeeType` has no `createdBy` column — company + `since` is all there is. */
  employeeTypesCreatedSince(
    scope: ReaderScope
  ): Promise<LearnEmployeeTypeRow[]>;
  employeeTypeGrantCount(
    employeeTypeIds: string[]
  ): Promise<Record<string, number>>;
  customFieldsCreatedBy(scope: ReaderScope): Promise<LearnCustomFieldRow[]>;
  invitesCreatedBy(scope: ReaderScope): Promise<LearnInviteRow[]>;
}

const NEWEST_FIRST = { ascending: false } as const;

export function makeSupabaseReader(
  client: SupabaseClient<Database>
): LearnReader {
  return {
    async itemsCreatedBy(scope) {
      const { data, error } = await client
        .from("item")
        .select("id, readableId, name, type")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("itemsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        readableId: row.readableId ?? "",
        name: row.name ?? "",
        type: row.type ?? ""
      }));
    },

    async purchaseOrdersCreatedBy(scope) {
      const { data, error } = await client
        .from("purchaseOrder")
        .select("id, purchaseOrderId, status, supplierId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("purchaseOrdersCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        purchaseOrderId: row.purchaseOrderId ?? "",
        status: row.status ?? "",
        supplierId: row.supplierId ?? ""
      }));
    },

    async purchaseOrderLines(companyId, purchaseOrderIds) {
      if (purchaseOrderIds.length === 0) return [];

      const { data, error } = await client
        .from("purchaseOrderLine")
        .select("purchaseOrderId, purchaseQuantity, purchaseOrderLineType")
        .eq("companyId", companyId)
        .in("purchaseOrderId", purchaseOrderIds);

      if (error || !data) return empty("purchaseOrderLines", error);
      return data.map((row) => ({
        purchaseOrderId: row.purchaseOrderId ?? "",
        purchaseQuantity: row.purchaseQuantity ?? null,
        purchaseOrderLineType: row.purchaseOrderLineType ?? ""
      }));
    },

    async receiptsCreatedBy(scope) {
      const { data, error } = await client
        .from("receipt")
        .select("id, receiptId, status, sourceDocument, sourceDocumentId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("receiptsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        receiptId: row.receiptId ?? "",
        status: row.status ?? "",
        sourceDocument: row.sourceDocument ?? null,
        sourceDocumentId: row.sourceDocumentId ?? null
      }));
    },

    async receiptLines(companyId, receiptIds) {
      if (receiptIds.length === 0) return [];

      const { data, error } = await client
        .from("receiptLine")
        .select("receiptId, receivedQuantity")
        .eq("companyId", companyId)
        .in("receiptId", receiptIds);

      if (error || !data) return empty("receiptLines", error);
      return data.map((row) => ({
        receiptId: row.receiptId ?? "",
        receivedQuantity: row.receivedQuantity ?? 0
      }));
    },

    /**
     * `supplier.createdBy` is NULLABLE — a supplier can arrive by import, by an
     * edge function, or from a portal — so filtering on it outright would fail
     * a learner who genuinely created one down an unattributed path.
     *
     * But a certification must not pass somebody on a colleague's work, so the
     * fallback is narrow: the learner's own rows first, then only rows with NO
     * recorded author. A supplier demonstrably created by a DIFFERENT user is
     * dropped entirely.
     */
    async suppliersCreatedSince(scope) {
      const { data, error } = await client
        .from("supplier")
        .select("id, name, createdBy")
        .eq("companyId", scope.companyId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("suppliersCreatedSince", error);

      const rows = data.map((row) => ({
        id: row.id,
        name: row.name ?? "",
        createdBy: row.createdBy ?? null
      }));

      // Stable partition: the learner's own first, then unattributed rows.
      // Someone else's supplier is never a candidate.
      return [
        ...rows.filter((row) => row.createdBy === scope.userId),
        ...rows.filter((row) => row.createdBy === null)
      ];
    },

    async supplierQuotesCreatedBy(scope) {
      const { data, error } = await client
        .from("supplierQuote")
        .select("id, status, supplierId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("supplierQuotesCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        status: row.status ?? "",
        supplierId: row.supplierId ?? ""
      }));
    },

    async supplierQuoteLineCount(companyId, supplierQuoteIds) {
      if (supplierQuoteIds.length === 0) return {};

      const { data, error } = await client
        .from("supplierQuoteLine")
        .select("supplierQuoteId")
        .eq("companyId", companyId)
        .in("supplierQuoteId", supplierQuoteIds);

      if (error || !data) return {};

      return tally(data, "supplierQuoteId");
    },

    // -------------------------------------------------------------- accounting

    async purchaseInvoicesCreatedBy(scope) {
      const { data, error } = await client
        .from("purchaseInvoice")
        .select("id, invoiceId, status")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("purchaseInvoicesCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        invoiceId: row.invoiceId ?? "",
        status: row.status ?? ""
      }));
    },

    async paymentsCreatedBy(scope) {
      const { data, error } = await client
        .from("payment")
        .select("id, paymentId, paymentType, status, supplierId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("paymentsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        paymentId: row.paymentId ?? "",
        paymentType: row.paymentType ?? "",
        status: row.status ?? "",
        supplierId: row.supplierId ?? null
      }));
    },

    async accountingPeriodsClosedBy(scope) {
      const { data, error } = await client
        .from("accountingPeriod")
        .select("id, fiscalYear, periodNumber, closeStatus")
        .eq("companyId", scope.companyId)
        .eq("closedBy", scope.userId)
        .gte("closedAt", scope.since)
        .order("closedAt", NEWEST_FIRST);

      if (error || !data) return empty("accountingPeriodsClosedBy", error);
      return data.map((row) => ({
        id: row.id,
        fiscalYear: row.fiscalYear ?? null,
        periodNumber: row.periodNumber ?? null,
        closeStatus: row.closeStatus ?? ""
      }));
    },

    // ------------------------------------------------------------------- sales

    async quotesCreatedBy(scope) {
      const { data, error } = await client
        .from("quote")
        .select("id, quoteId, status, opportunityId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("quotesCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        quoteId: row.quoteId ?? "",
        status: row.status ?? "",
        opportunityId: row.opportunityId ?? null
      }));
    },

    async quoteLineCount(companyId, quoteIds) {
      if (quoteIds.length === 0) return {};

      const { data, error } = await client
        .from("quoteLine")
        .select("quoteId")
        .eq("companyId", companyId)
        .in("quoteId", quoteIds);

      if (error || !data) return {};
      return tally(data, "quoteId");
    },

    async salesOrdersCreatedBy(scope) {
      const { data, error } = await client
        .from("salesOrder")
        .select("id, salesOrderId, status, customerId, opportunityId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("salesOrdersCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        salesOrderId: row.salesOrderId ?? "",
        status: row.status ?? "",
        customerId: row.customerId ?? "",
        opportunityId: row.opportunityId ?? null
      }));
    },

    async shipmentsCreatedBy(scope) {
      const { data, error } = await client
        .from("shipment")
        .select("id, shipmentId, status, customerId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("shipmentsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        shipmentId: row.shipmentId ?? "",
        status: row.status ?? "",
        customerId: row.customerId ?? null
      }));
    },

    async salesInvoicesCreatedBy(scope) {
      const { data, error } = await client
        .from("salesInvoice")
        .select("id, invoiceId, status, customerId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("salesInvoicesCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        invoiceId: row.invoiceId ?? "",
        status: row.status ?? "",
        customerId: row.customerId ?? ""
      }));
    },

    // --------------------------------------------------------------- inventory

    async itemLedgerEntriesCreatedBy(scope) {
      const { data, error } = await client
        .from("itemLedger")
        .select("id, entryType, quantity, itemId")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("itemLedgerEntriesCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        entryType: row.entryType ?? "",
        quantity: row.quantity ?? 0,
        itemId: row.itemId ?? ""
      }));
    },

    async stockTransfersCreatedBy(scope) {
      const { data, error } = await client
        .from("stockTransfer")
        .select("id, stockTransferId, status")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("stockTransfersCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        stockTransferId: row.stockTransferId ?? "",
        status: row.status ?? ""
      }));
    },

    async inventoryCountsCreatedBy(scope) {
      const { data, error } = await client
        .from("inventoryCount")
        .select("id, inventoryCountId, status")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("inventoryCountsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        inventoryCountId: row.inventoryCountId ?? "",
        status: row.status ?? ""
      }));
    },

    async inventoryCountLineCount(companyId, inventoryCountIds) {
      if (inventoryCountIds.length === 0) return {};

      const { data, error } = await client
        .from("inventoryCountLine")
        .select("inventoryCountId")
        .eq("companyId", companyId)
        .in("inventoryCountId", inventoryCountIds);

      if (error || !data) return {};
      return tally(data, "inventoryCountId");
    },

    // -------------------------------------------------------------- production

    async jobsCreatedBy(scope) {
      const { data, error } = await client
        .from("job")
        .select("id, jobId, status, quantityComplete")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("jobsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        jobId: row.jobId ?? "",
        status: row.status ?? "",
        quantityComplete: row.quantityComplete ?? 0
      }));
    },

    async jobOperationCount(companyId, jobIds) {
      if (jobIds.length === 0) return {};

      const { data, error } = await client
        .from("jobOperation")
        .select("jobId")
        .eq("companyId", companyId)
        .in("jobId", jobIds);

      if (error || !data) return {};
      return tally(data, "jobId");
    },

    async jobMaterialCount(companyId, jobIds) {
      if (jobIds.length === 0) return {};

      const { data, error } = await client
        .from("jobMaterial")
        .select("jobId")
        .eq("companyId", companyId)
        .in("jobId", jobIds);

      if (error || !data) return {};
      return tally(data, "jobId");
    },

    // ---------------------------------------------------------------- planning

    async itemPlanningUpdatedBy(scope) {
      const { data, error } = await client
        .from("itemPlanning")
        .select(
          "itemId, reorderingPolicy, reorderPoint, reorderQuantity, maximumInventoryQuantity, demandAccumulationPeriod"
        )
        .eq("companyId", scope.companyId)
        .eq("updatedBy", scope.userId)
        .gte("updatedAt", scope.since)
        .order("updatedAt", NEWEST_FIRST);

      if (error || !data) return empty("itemPlanningUpdatedBy", error);
      return data.map((row) => ({
        itemId: row.itemId ?? "",
        reorderingPolicy: row.reorderingPolicy ?? "",
        reorderPoint: row.reorderPoint ?? null,
        reorderQuantity: row.reorderQuantity ?? null,
        maximumInventoryQuantity: row.maximumInventoryQuantity ?? null,
        demandAccumulationPeriod: row.demandAccumulationPeriod ?? null
      }));
    },

    async purchaseOrderLinesForItems(scope, itemIds) {
      if (itemIds.length === 0) return [];

      const { data, error } = await client
        .from("purchaseOrderLine")
        .select("purchaseOrderId, itemId")
        .eq("companyId", scope.companyId)
        .in("itemId", itemIds)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("purchaseOrderLinesForItems", error);
      return data.map((row) => ({
        purchaseOrderId: row.purchaseOrderId ?? "",
        itemId: row.itemId ?? ""
      }));
    },

    // ----------------------------------------------------------------- quality

    async nonConformancesCreatedBy(scope) {
      const { data, error } = await client
        .from("nonConformance")
        .select("id, nonConformanceId, name, status, closeDate")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("nonConformancesCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        nonConformanceId: row.nonConformanceId ?? "",
        name: row.name ?? "",
        status: row.status ?? "",
        closeDate: row.closeDate ?? null
      }));
    },

    async inspectionsCreatedBy(scope) {
      const { data, error } = await client
        .from("inspection")
        .select("id, inspectionId, status")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("inspectionsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        inspectionId: row.inspectionId ?? "",
        status: row.status ?? null
      }));
    },

    // ------------------------------------------------------------------- admin

    async employeeTypesCreatedSince(scope) {
      const { data, error } = await client
        .from("employeeType")
        .select("id, name")
        .eq("companyId", scope.companyId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("employeeTypesCreatedSince", error);
      return data.map((row) => ({ id: row.id, name: row.name ?? "" }));
    },

    /**
     * `employeeTypePermission` carries no `companyId` — the ids passed in are
     * already company-scoped by `employeeTypesCreatedSince`, and that is what
     * keeps this read tenant-safe.
     */
    async employeeTypeGrantCount(employeeTypeIds) {
      if (employeeTypeIds.length === 0) return {};

      const { data, error } = await client
        .from("employeeTypePermission")
        .select("employeeTypeId, view, create, update, delete")
        .in("employeeTypeId", employeeTypeIds);

      if (error || !data) return {};

      const counts: Record<string, number> = {};
      for (const row of data) {
        const id = row.employeeTypeId ?? "";
        if (!id) continue;
        const granted = [row.view, row.create, row.update, row.delete].some(
          (arr) => Array.isArray(arr) && arr.length > 0
        );
        if (granted) counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    },

    async customFieldsCreatedBy(scope) {
      const { data, error } = await client
        .from("customField")
        .select("id, name, table, active")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("customFieldsCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        name: row.name ?? "",
        table: row.table ?? "",
        active: row.active ?? false
      }));
    },

    async invitesCreatedBy(scope) {
      const { data, error } = await client
        .from("invite")
        .select("id, email, role, permissions")
        .eq("companyId", scope.companyId)
        .eq("createdBy", scope.userId)
        .gte("createdAt", scope.since)
        .order("createdAt", NEWEST_FIRST);

      if (error || !data) return empty("invitesCreatedBy", error);
      return data.map((row) => ({
        id: row.id,
        email: row.email ?? "",
        role: row.role ?? null,
        permissionCount: countGrantedPermissions(
          row.permissions,
          scope.companyId
        )
      }));
    }
  };
}
