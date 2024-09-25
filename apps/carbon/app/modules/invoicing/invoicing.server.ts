import { getCarbonServiceRole } from "@carbon/auth";

export async function createPurchaseInvoiceFromPurchaseOrder(
  purchaseOrderId: string,
  companyId: string,
  userId: string
) {
  const client = getCarbonServiceRole();
  return client.functions.invoke<{ id: string }>(
    "create-purchase-invoice-from-purchase-order",
    {
      body: {
        id: purchaseOrderId,
        companyId,
        userId,
      },
    }
  );
}
