import { useNavigate } from "@remix-run/react";
import { useCallback } from "react";
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
