import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSubmit } from "react-router";
import type { Receipt, Shipment } from "~/modules/inventory";
import type { PurchaseInvoice } from "~/modules/invoicing";
import type { PurchaseOrder } from "~/modules/purchasing";
import { path } from "~/utils/path";

const MAX_RELATED_DOCS_RETRIES = 2;
const RELATED_DOCS_RETRY_DELAY_MS = 1000;

export const usePurchaseOrder = () => {
  const navigate = useNavigate();
  const submit = useSubmit();

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
    (purchaseOrder: PurchaseOrder) => {
      if (!purchaseOrder.id) return;
      const formData = new FormData();
      formData.set("sourceDocument", "Purchase Order");
      formData.set("sourceDocumentId", purchaseOrder.id);
      submit(formData, { method: "post", action: path.to.newReceipt });
    },
    [submit]
  );

  const ship = useCallback(
    (purchaseOrder: PurchaseOrder) => {
      if (!purchaseOrder.id) return;
      const formData = new FormData();
      formData.set("sourceDocument", "Purchase Order");
      formData.set("sourceDocumentId", purchaseOrder.id);
      submit(formData, { method: "post", action: path.to.newShipment });
    },
    [submit]
  );

  return {
    edit,
    invoice,
    receive,
    ship
  };
};

export const usePurchaseOrderRelatedDocuments = (
  supplierInteractionId: string,
  isOutsideProcessing: boolean
) => {
  const [receipts, setReceipts] = useState<
    Pick<Receipt, "id" | "receiptId" | "status">[]
  >([]);
  const [invoices, setInvoices] = useState<
    Pick<PurchaseInvoice, "id" | "invoiceId" | "status">[]
  >([]);
  const [shipments, setShipments] = useState<
    Pick<Shipment, "id" | "shipmentId" | "status">[]
  >([]);
  const [hasError, setHasError] = useState(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const { carbon } = useCarbon();

  const getRelatedDocuments = useCallback(
    async (supplierInteractionId: string, attempt = 0) => {
      if (!carbon || !supplierInteractionId) return;
      const [receipts, invoices, shipments] = await Promise.all([
        carbon
          .from("receipt")
          .select("id, receiptId, status")
          .eq("supplierInteractionId", supplierInteractionId),
        carbon
          .from("purchaseInvoice")
          .select("id, invoiceId, status, datePaid, dateDue")
          .eq("supplierInteractionId", supplierInteractionId),
        isOutsideProcessing
          ? carbon
              .from("shipment")
              .select("id, shipmentId, status")
              .eq("supplierInteractionId", supplierInteractionId)
          : Promise.resolve({ data: [], error: null })
      ]);

      const failed = !!receipts.error || !!invoices.error || !!shipments.error;
      // Retry transient failures before surfacing a hard error, so a network
      // blip doesn't leave Ship/Receive/Invoice permanently disabled. Only
      // toast / commit the error state on the final attempt.
      const willRetry = failed && attempt < MAX_RELATED_DOCS_RETRIES;

      if (receipts.error) {
        if (!willRetry) toast.error("Failed to load receipts");
      } else {
        setReceipts(receipts.data);
      }

      if (invoices.error) {
        if (!willRetry) toast.error("Failed to load invoices");
      } else {
        setInvoices(
          invoices.data?.map((invoice) => ({
            ...invoice,
            status: invoice.dateDue
              ? !invoice.datePaid && new Date(invoice.dateDue) < new Date()
                ? "Overdue"
                : invoice.status
              : invoice.status
          })) ?? []
        );
      }
      if (shipments.error) {
        if (!willRetry) toast.error("Failed to load shipments");
      } else {
        setShipments(shipments.data);
      }

      if (willRetry) {
        retryTimeoutRef.current = setTimeout(
          () => getRelatedDocuments(supplierInteractionId, attempt + 1),
          RELATED_DOCS_RETRY_DELAY_MS * (attempt + 1)
        );
        return;
      }

      setHasError(failed);
    },
    [carbon, isOutsideProcessing]
  );

  useEffect(() => {
    getRelatedDocuments(supplierInteractionId);
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [getRelatedDocuments, supplierInteractionId]);

  return { receipts, invoices, shipments, hasError };
};
