import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import type { Receipt } from "~/modules/inventory";
import type { PurchaseOrder } from "~/modules/purchasing";
import { path } from "~/utils/path";

export const usePurchaseOrder = () => {
  const navigate = useNavigate();

  const edit = useCallback(
    (purchaseOrder: PurchaseOrder) =>
      navigate(path.to.purchaseOrder(purchaseOrder.id!)),
    [navigate]
  );

  const invoice = useCallback(
    (purchaseOrder: PurchaseOrder) =>
      navigate(
        `${path.to.newPurchaseInvoice}?sourceDocument=Purchase Order&sourceDocumentId=${purchaseOrder.id}`
      ),
    [navigate]
  );

  const receive = useCallback(
    (purchaseOrder: PurchaseOrder) =>
      navigate(
        `${path.to.newReceipt}?sourceDocument=Purchase Order&sourceDocumentId=${purchaseOrder.id}`
      ),
    [navigate]
  );

  return {
    edit,
    invoice,
    receive,
  };
};

export const usePurchaseOrderReceipts = (purchaseOrderId: string) => {
  const [receipts, setReceipts] = useState<
    Pick<Receipt, "id" | "receiptId" | "status">[]
  >([]);
  const { carbon } = useCarbon();

  const getReceipts = useCallback(
    async (purchaseOrderId: string) => {
      if (!carbon || !purchaseOrderId) return;
      const { data, error } = await carbon
        .from("receipt")
        .select("id, receiptId, status")
        .eq("sourceDocumentId", purchaseOrderId);

      if (error) {
        toast.error("Failed to load receipts");
        return;
      }

      setReceipts(data);
    },
    [carbon]
  );

  useEffect(() => {
    getReceipts(purchaseOrderId);
  }, [getReceipts, purchaseOrderId]);

  return receipts;
};
