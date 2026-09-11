import { type Database, fetchAllFromTable } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadRampPurchaseOrderLines(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderIds: string[]
) {
  const result = await fetchAllFromTable<{
    id: string;
    purchaseOrderId: string;
    description: string | null;
    purchaseQuantity: number | null;
    supplierUnitPrice: number | null;
    purchaseOrderLineType: string;
    sortOrder: number;
  }>(
    client,
    "purchaseOrderLine",
    "id, purchaseOrderId, description, purchaseQuantity, supplierUnitPrice, purchaseOrderLineType, sortOrder",
    (query) =>
      query
        .eq("companyId", companyId)
        .in("purchaseOrderId", purchaseOrderIds)
        .neq("purchaseOrderLineType", "Comment")
        .order("sortOrder", { ascending: true })
  );
  if (result.error) {
    throw new Error(
      `Failed to load Ramp purchase-order lines: ${result.error.message}`
    );
  }
  return result.data;
}

export async function loadRampPurchaseInvoiceLines(
  client: SupabaseClient<Database>,
  companyId: string,
  invoiceIds: string[]
) {
  const result = await fetchAllFromTable<{
    invoiceId: string;
    description: string | null;
    totalAmount: number | null;
    sortOrder: number;
  }>(
    client,
    "purchaseInvoiceLine",
    "invoiceId, description, totalAmount, sortOrder",
    (query) =>
      query
        .eq("companyId", companyId)
        .in("invoiceId", invoiceIds)
        .order("sortOrder", { ascending: true })
  );
  if (result.error) {
    throw new Error(
      `Failed to load Ramp purchase-invoice lines: ${result.error.message}`
    );
  }
  return result.data;
}
