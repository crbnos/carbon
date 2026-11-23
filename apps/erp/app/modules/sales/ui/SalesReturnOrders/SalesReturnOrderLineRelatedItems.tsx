// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Count, cn, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Suspense, useState } from "react";
import {
  LuChevronRight,
  LuHeadphones,
  LuPackageCheck,
  LuTruck
} from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Hyperlink } from "~/components";
import { LevelLine } from "~/components/TreeView";
import { useRouteData } from "~/hooks";
import type { getSalesReturnOrderRelatedItems } from "~/modules/sales/sales.service";
import ServiceJobStatus from "~/modules/service/ui/ServiceJob/ServiceJobStatus";
import { path } from "~/utils/path";
import type { SalesReturnOrderLine } from "./types";

type SalesReturnOrderRelatedItems = Awaited<
  ReturnType<typeof getSalesReturnOrderRelatedItems>
>;

type RelatedItem = {
  id: string;
  readableId: string;
  to: string;
  status?: ReactNode;
};

type RelatedItemNode = {
  key: "serviceJobs" | "receipts" | "shipments";
  name: string;
  icon: ReactNode;
  children: RelatedItem[];
};

/**
 * The documents of one RMA line, as the sales order shows a line's jobs and
 * shipments: its service jobs, and the receipts and shipments that moved it.
 */
export default function SalesReturnOrderLineRelatedItems({
  line
}: {
  line: SalesReturnOrderLine;
}) {
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const routeData = useRouteData<{
    relatedItems: Promise<SalesReturnOrderRelatedItems>;
  }>(path.to.salesReturnOrder(orderId));

  return (
    <Suspense
      fallback={
        <div className="p-2 text-sm text-muted-foreground">
          <Trans>Loading related items...</Trans>
        </div>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(relatedItems) => (
          <RelatedItemTree line={line} relatedItems={relatedItems} />
        )}
      </Await>
    </Suspense>
  );
}

function RelatedItemTree({
  line,
  relatedItems
}: {
  line: SalesReturnOrderLine;
  relatedItems: SalesReturnOrderRelatedItems | undefined;
}) {
  const { t } = useLingui();

  const nodes: RelatedItemNode[] = [
    {
      key: "serviceJobs",
      name: t`Service Jobs`,
      icon: <LuHeadphones />,
      children: (line.serviceJob ?? []).map((job) => ({
        id: job.id,
        readableId: job.serviceJobId,
        to: path.to.serviceJob(job.id),
        status: <ServiceJobStatus status={job.status} />
      }))
    },
    {
      key: "receipts",
      name: t`Receipts`,
      icon: <LuPackageCheck />,
      children: (relatedItems?.receipts ?? [])
        .filter((receipt) =>
          receipt.receiptLine.some(
            (receiptLine) =>
              receiptLine.lineId === line.id &&
              Number(receiptLine.receivedQuantity ?? 0) > 0
          )
        )
        .map((receipt) => ({
          id: receipt.id,
          readableId: receipt.receiptId,
          to: path.to.receipt(receipt.id)
        }))
    },
    {
      key: "shipments",
      name: t`Shipments`,
      icon: <LuTruck />,
      children: (relatedItems?.shipments ?? [])
        .filter((shipment) =>
          shipment.shipmentLine.some(
            (shipmentLine) =>
              shipmentLine.lineId === line.id &&
              Number(shipmentLine.shippedQuantity ?? 0) > 0
          )
        )
        .map((shipment) => ({
          id: shipment.id,
          readableId: shipment.shipmentId,
          to: path.to.shipment(shipment.id)
        }))
    }
  ];

  return (
    <VStack spacing={0} className="w-full p-2">
      {nodes.map((node) => (
        <RelatedItemTreeNode key={node.key} node={node} />
      ))}
    </VStack>
  );
}

function RelatedItemTreeNode({ node }: { node: RelatedItemNode }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <>
      <button
        type="button"
        className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-2 gap-2 text-sm hover:bg-accent w-full font-medium"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="h-8 w-4 flex items-center justify-center">
          <LuChevronRight className={cn("size-4", isExpanded && "rotate-90")} />
        </div>
        <div className="flex flex-grow items-center justify-between gap-2">
          <span>{node.name}</span>
          {node.children.length > 0 && <Count count={node.children.length} />}
        </div>
      </button>
      {isExpanded && (
        <div className="flex flex-col w-full">
          {node.children.length === 0 ? (
            <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
              <LevelLine isSelected={false} />
              <div className="text-xs text-muted-foreground">
                {node.key === "serviceJobs" ? (
                  <Trans>No service jobs found</Trans>
                ) : node.key === "receipts" ? (
                  <Trans>No receipts found</Trans>
                ) : (
                  <Trans>No shipments found</Trans>
                )}
              </div>
            </div>
          ) : (
            node.children.map((child) => (
              <Hyperlink
                key={child.id}
                to={child.to}
                className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-accent w-full font-medium whitespace-nowrap"
              >
                <LevelLine isSelected={false} className="mr-2" />
                <div className="mr-2 text-muted-foreground">{node.icon}</div>
                <span className="truncate">{child.readableId}</span>
                {child.status && (
                  <span className="ml-auto pr-1">{child.status}</span>
                )}
              </Hyperlink>
            ))
          )}
        </div>
      )}
    </>
  );
}
