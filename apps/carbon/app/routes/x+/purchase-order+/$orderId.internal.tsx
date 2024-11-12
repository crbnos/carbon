import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { PurchaseOrderAttachment } from "~/modules/purchasing";
import { PurchaseOrderDocuments } from "~/modules/purchasing";
import { path } from "~/utils/path";

export function action() {
  // used for reloading the data via fetcher.submit(null, { method: 'post'})
  return null;
}

export default function PurchaseOrderInternalDocumentsRoute() {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    internalDocuments: Promise<PurchaseOrderAttachment[]>;
  }>(path.to.purchaseOrder(orderId));

  return (
    <PurchaseOrderDocuments
      attachments={routeData?.internalDocuments!}
      isExternal={false}
      orderId={orderId}
    />
  );
}
