import { getCarbonServiceRole } from "@carbon/auth";

export async function createPurchaseInvoiceFromPurchaseOrder(
  purchaseOrderId: string,
  companyId: string,
  userId: string
) {
  const client = getCarbonServiceRole();
  return client.functions.invoke<{ id: string }>("convert", {
    body: {
      type: "purchaseOrderToPurchaseInvoice",
      id: purchaseOrderId,
      companyId,
      userId,
    },
  });
}
