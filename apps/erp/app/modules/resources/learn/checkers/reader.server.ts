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
     * edge function, or from a portal, and filtering on it would fail a learner
     * who genuinely created one. So this filters on company + `since` only, and
     * hoists the rows the learner demonstrably created to the front. The
     * checker takes the first row and therefore prefers their own supplier
     * whenever one exists.
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

      // Stable partition: the learner's own first, each group still newest-first.
      return [
        ...rows.filter((row) => row.createdBy === scope.userId),
        ...rows.filter((row) => row.createdBy !== scope.userId)
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

      const counts: Record<string, number> = {};
      for (const row of data) {
        const quoteId = row.supplierQuoteId ?? "";
        if (!quoteId) continue;
        counts[quoteId] = (counts[quoteId] ?? 0) + 1;
      }
      return counts;
    }
  };
}
