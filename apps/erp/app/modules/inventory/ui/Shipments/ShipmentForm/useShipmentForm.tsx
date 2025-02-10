import { useCarbon } from "@carbon/auth";
import { useParams } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { useRouteData, useUser } from "~/hooks";
import type {
  Shipment,
  ShipmentSourceDocument,
} from "~/modules/inventory/types";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

export default function useShipmentForm() {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const shipmentData = useRouteData<{
    shipment: Shipment;
  }>(path.to.shipment(shipmentId));
  if (!shipmentData) throw new Error("Could not find shipmentData");
  const shipment = shipmentData.shipment;

  const user = useUser();
  const [error, setError] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const [locationId, setLocationId] = useState<string | null>(
    shipment.locationId ?? user.defaults.locationId ?? null
  );
  const [customerId, setSupplierId] = useState<string | null>(
    shipment.customerId ?? null
  );

  const [sourceDocuments, setSourceDocuments] = useState<ListItem[]>([]);
  const [sourceDocument, setSourceDocument] = useState<ShipmentSourceDocument>(
    shipment.sourceDocument ?? "Sales Order"
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

      default:
        setSourceDocuments([]);
    }
  }, [sourceDocument, carbon, user.company.id]);

  useEffect(() => {
    fetchSourceDocuments();
  }, [fetchSourceDocuments, sourceDocument]);

  return {
    error,
    locationId,
    customerId,
    sourceDocuments,
    setLocationId,
    setSourceDocument,
    setSupplierId,
  };
}
