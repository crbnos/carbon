import { useCarbon } from "@carbon/auth";
import { useParams } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { useRouteData, useUser } from "~/hooks";
import type { Receipt, ReceiptSourceDocument } from "~/modules/inventory/types";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

export default function useReceiptForm() {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const receiptData = useRouteData<{
    receipt: Receipt;
  }>(path.to.receipt(receiptId));
  if (!receiptData) throw new Error("Could not find receiptData");
  const receipt = receiptData.receipt;

  const user = useUser();
  const [error, setError] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const routeData = useRouteData<{
    locations: ListItem[];
  }>(path.to.receiptRoot);

  const [locationId, setLocationId] = useState<string | null>(
    receipt.locationId ?? user.defaults.locationId ?? null
  );
  const [supplierId, setSupplierId] = useState<string | null>(
    receipt.supplierId ?? null
  );

  const [sourceDocuments, setSourceDocuments] = useState<ListItem[]>([]);
  const [sourceDocument, setSourceDocument] = useState<ReceiptSourceDocument>(
    receipt.sourceDocument ?? "Purchase Order"
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
    locations: routeData?.locations ?? [],
    supplierId,
    sourceDocuments,
    setLocationId,
    setSourceDocument,
    setSupplierId,
  };
}
