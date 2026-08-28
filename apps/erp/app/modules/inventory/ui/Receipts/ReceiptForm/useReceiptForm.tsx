import { useCarbon } from "@carbon/auth";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import type { z } from "zod";
import { useUser } from "~/hooks";
import type { receiptStatusType } from "~/modules/inventory";
import type { receiptValidator } from "~/modules/inventory/inventory.models";
import type { ReceiptSourceDocument } from "~/modules/inventory/types";
import type { ListItem } from "~/types";

export default function useReceiptForm({
  status,
  initialValues
}: {
  initialValues: z.infer<typeof receiptValidator>;
  status: (typeof receiptStatusType)[number];
}) {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const user = useUser();
  const [error, setError] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const [locationId, setLocationId] = useState<string | null>(
    initialValues.locationId ?? user.defaults.locationId ?? null
  );
  const [supplierId, setSupplierId] = useState<string | null>(
    initialValues.supplierId ?? null
  );

  const [sourceDocuments, setSourceDocuments] = useState<ListItem[]>(() => {
    return status === "Posted"
      ? [
          {
            id: initialValues.sourceDocumentId!,
            name: initialValues.sourceDocumentReadableId!
          }
        ]
      : [];
  });
  const [sourceDocument, setSourceDocument] = useState<ReceiptSourceDocument>(
    initialValues.sourceDocument ?? "Purchase Order"
  );

  const fetchSourceDocuments = useCallback(() => {
    if (!carbon || !user.company.id) return;

    switch (sourceDocument) {
      case "Purchase Order":
        carbon
          ?.from("purchaseOrder")
          .select("id, purchaseOrderId")
          .eq("companyId", user.company.id)
          .or("status.eq.To Receive, status.eq.To Receive and Invoice")
          .then((response) => {
            if (response.error) {
              setError(response.error.message);
            } else {
              setSourceDocuments(
                response.data.map((d) => ({
                  name: d.purchaseOrderId,
                  id: d.id
                }))
              );
            }
          });
        break;

      case "Sales Return Order":
        carbon
          ?.from("salesReturnOrder")
          .select("id, salesReturnOrderId")
          .eq("companyId", user.company.id)
          .or("status.eq.Confirmed, status.eq.Partially Received")
          .then((response) => {
            if (response.error) {
              setError(response.error.message);
            } else {
              setSourceDocuments(
                response.data.map((d) => ({
                  name: d.salesReturnOrderId,
                  id: d.id
                }))
              );
            }
          });
        break;

      case "Repair Order":
        carbon
          ?.from("repairOrder")
          .select("id, repairOrderId")
          .eq("companyId", user.company.id)
          .in("status", ["Confirmed", "In Progress"])
          .then((response) => {
            if (response.error) {
              setError(response.error.message);
            } else {
              setSourceDocuments(
                response.data.map((d) => ({
                  name: d.repairOrderId,
                  id: d.id
                }))
              );
            }
          });
        break;

      case "Inbound Transfer":
        carbon
          ?.from("warehouseTransfer")
          .select("id, transferId")
          .eq("companyId", user.company.id)
          .or(
            "status.eq.To Ship and Receive, status.eq.To Receive, status.eq.To Ship"
          )
          .then((response) => {
            if (response.error) {
              setError(response.error.message);
            } else {
              setSourceDocuments(
                response.data.map((d) => ({
                  name: d.transferId,
                  id: d.id
                }))
              );
            }
          });
        break;

      default:
        setSourceDocuments([]);
    }
  }, [sourceDocument, carbon, user.company.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (status !== "Posted") {
      fetchSourceDocuments();
    }
  }, [sourceDocument, status]);

  return {
    error,
    locationId,
    supplierId,
    sourceDocuments,
    setLocationId,
    setSourceDocument,
    setSupplierId
  };
}
