import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import type { Receipt } from "~/modules/inventory";
import type { PurchaseInvoice } from "~/modules/invoicing";
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

export const usePurchaseOrderRelatedDocuments = (
  supplierInteractionId: string
) => {
  const [receipts, setReceipts] = useState<
    Pick<Receipt, "id" | "receiptId" | "status">[]
  >([]);
  const [invoices, setInvoices] = useState<
    Pick<PurchaseInvoice, "id" | "invoiceId" | "status">[]
  >([]);

  const { carbon } = useCarbon();

  const getRelatedDocuments = useCallback(
    async (supplierInteractionId: string) => {
      if (!carbon || !supplierInteractionId) return;
      const [receipts, invoices] = await Promise.all([
        carbon
          .from("receipt")
          .select("id, receiptId, status")
          .eq("supplierInteractionId", supplierInteractionId),
        carbon
          .from("purchaseInvoice")
          .select("id, invoiceId, status")
          .eq("supplierInteractionId", supplierInteractionId),
      ]);

      if (receipts.error) {
        toast.error("Failed to load receipts");
      } else {
        setReceipts(receipts.data);
      }

      if (invoices.error) {
        toast.error("Failed to load invoices");
      } else {
        setInvoices(invoices.data);
      }
    },
    [carbon]
  );

  useEffect(() => {
    getRelatedDocuments(supplierInteractionId);
  }, [getRelatedDocuments, supplierInteractionId]);

  return { receipts, invoices };
};
