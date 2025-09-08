import { useCarbon } from "@carbon/auth";
import { useParams } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { useUser } from "~/hooks";
import type { z } from "zod";
import type { ShipmentSourceDocument } from "~/modules/inventory/types";
import type { shipmentStatusType, shipmentValidator } from "~/modules/inventory";
import type { ListItem } from "~/types";

export default function useShipmentForm({
  status,
  initialValues,
}: {
  initialValues: z.infer<typeof shipmentValidator>;
  status: (typeof shipmentStatusType)[number];
}) {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const user = useUser();
  const [error, setError] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const [locationId, setLocationId] = useState<string | null>(
    initialValues.locationId ?? user.defaults.locationId ?? null
  );
  const [customerId, setCustomerId] = useState<string | null>(
    initialValues.customerId ?? null
  );

  const [sourceDocuments, setSourceDocuments] = useState<ListItem[]>(() => {
    return status === "Posted"
      ? [
          {
            id: initialValues.sourceDocumentId!,
            name: initialValues.sourceDocumentReadableId!,
          },
        ]
      : [];
  });
  const [sourceDocument, setSourceDocument] = useState<ShipmentSourceDocument>(
    initialValues.sourceDocument ?? "Sales Order"
  );

  const fetchSourceDocuments = useCallback(() => {
    if (!carbon || !user.company.id) return;

    switch (sourceDocument) {
      case "Sales Order":
        carbon
          ?.from("salesOrder")
          .select("id, salesOrderId")
          .eq("companyId", user.company.id)
          .or("status.eq.To Ship, status.eq.To Ship and Invoice")
          .then((response) => {
            if (response.error) {
              setError(response.error.message);
            } else {
              setSourceDocuments(
                response.data.map((d) => ({
                  name: d.salesOrderId,
                  id: d.id,
                }))
              );
            }
          });
        break;
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
                  id: d.id,
                }))
              );
            }
          });
        break;
      case "Outbound Transfer":
        carbon
          ?.from("warehouseTransfer")
          .select("id, transferId")
          .eq("companyId", user.company.id)
          .or("status.eq.To Ship and Receive, status.eq.To Ship")
          .then((response) => {
            if (response.error) {
              setError(response.error.message);
            } else {
              setSourceDocuments(
                response.data.map((d) => ({
                  name: d.transferId,
                  id: d.id,
                }))
              );
            }
          });
        break;
      default:
        setSourceDocuments([]);
    }
  }, [sourceDocument, carbon, user.company.id]);

  useEffect(() => {
    if (status !== "Posted") {
      fetchSourceDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDocument, status]);

  return {
    error,
    locationId,
    customerId,
    sourceDocuments,
    setLocationId,
    setSourceDocument,
    setCustomerId,
  };
}
