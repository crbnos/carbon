// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuHandCoins, LuTruck } from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { getWarehouseTransferRelatedItems } from "../../inventory.service";
import { ReceiptStatus } from "../Receipts";
import { ShipmentStatus } from "../Shipments";

type RelatedItems = Awaited<
  ReturnType<typeof getWarehouseTransferRelatedItems>
>;

/**
 * The documents a warehouse transfer has raised: the shipments that send it
 * out, then the receipts that take it in.
 */
const WarehouseTransferDocuments = () => {
  const { t } = useLingui();
  const { transferId } = useParams();
  if (!transferId) throw new Error("transferId not found");

  const routeData = useRouteData<{
    relatedItems?: Promise<RelatedItems>;
  }>(path.to.warehouseTransfer(transferId));

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          <RelatedDocumentSkeleton />
          <RelatedDocumentSkeleton />
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(resolved) => {
          const shipments = resolved?.shipments ?? [];
          const receipts = resolved?.receipts ?? [];

          if (shipments.length === 0 && receipts.length === 0) {
            return <Empty className="py-12" />;
          }

          return (
            <RelatedDocumentGroup>
              {shipments.map((shipment) => (
                <RelatedDocument
                  key={shipment.id}
                  to={path.to.shipment(shipment.id)}
                  icon={<LuTruck />}
                  title={shipment.shipmentId}
                  description={t`Shipment`}
                  status={<ShipmentStatus status={shipment.status} />}
                />
              ))}
              {receipts.map((receipt) => (
                <RelatedDocument
                  key={receipt.id}
                  to={path.to.receipt(receipt.id)}
                  icon={<LuHandCoins />}
                  title={receipt.receiptId}
                  description={t`Receipt`}
                  status={<ReceiptStatus status={receipt.status} />}
                />
              ))}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default WarehouseTransferDocuments;
