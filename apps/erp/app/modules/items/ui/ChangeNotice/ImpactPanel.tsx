// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ITEM_PAGES } from "@carbon/database/access";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCircleCheck } from "react-icons/lu";
import { UsedInItem, type UsedInNode } from "../Item/UsedIn";

type UsedInChild = UsedInNode["children"][number];

// Where an affected item is referenced across the system (jobs, POs, sales,
// receipts, methods, NCRs, …) — the same shape the part detail page's "Used In"
// tree consumes. One entry per affected item on the change notice.
export type ChangeNoticeImpactItem = {
  itemId: string;
  readableIdWithRevision: string;
  itemName: string | null;
  usedIn: {
    issues: UsedInChild[];
    jobs: UsedInChild[];
    jobMaterials: UsedInChild[];
    maintenanceDispatchItems: UsedInChild[];
    methodMaterials: UsedInChild[];
    purchaseOrderLines: UsedInChild[];
    receiptLines: UsedInChild[];
    quoteLines: UsedInChild[];
    quoteMaterials: UsedInChild[];
    salesOrderLines: UsedInChild[];
    shipmentLines: UsedInChild[];
    supplierQuotes: UsedInChild[];
    assemblyInstructions: UsedInChild[];
  };
};

// One affected item's where-used tree. Categories are built exactly like the
// part detail page's Used In panel (kept in parallel with x+/part+/$itemId), but
// empty categories are dropped — the impact only lists where the item actually
// appears.
function ImpactItem({ item }: { item: ChangeNoticeImpactItem }) {
  const { t } = useLingui();
  const u = item.usedIn;

  const tree: UsedInNode[] = [
    {
      key: "issues",
      name: t`Issues`,
      pages: ["quality.issues"],
      children: u.issues
    },
    {
      key: "jobs",
      name: t`Jobs`,
      pages: ["production.jobs"],
      children: u.jobs.map((job) => ({ ...job, methodType: "Make to Order" }))
    },
    {
      key: "jobMaterials",
      name: t`Job Materials`,
      pages: ["production.jobs"],
      children: u.jobMaterials
    },
    {
      key: "maintenanceDispatchItems",
      name: t`Maintenance`,
      pages: ["resources.dispatches"],
      children: u.maintenanceDispatchItems
    },
    {
      key: "assemblyInstructions",
      name: t`Assembly Instructions`,
      pages: ["production.assemblies"],
      children: u.assemblyInstructions
    },
    {
      key: "methodMaterials",
      name: t`Method Materials`,
      pages: ITEM_PAGES,
      children: u.methodMaterials
    },
    {
      key: "purchaseOrderLines",
      name: t`Purchase Orders`,
      pages: ["purchasing.purchaseOrders"],
      children: u.purchaseOrderLines.map((po) => ({
        ...po,
        methodType: "Purchase to Order"
      }))
    },
    {
      key: "receiptLines",
      name: t`Receipts`,
      pages: ["inventory.receipts"],
      children: u.receiptLines.map((receipt) => ({
        ...receipt,
        methodType: "Pull from Inventory"
      }))
    },
    {
      key: "quoteLines",
      name: t`Quotes`,
      pages: ["sales.quotes"],
      children: u.quoteLines
    },
    {
      key: "quoteMaterials",
      name: t`Quote Materials`,
      pages: ["sales.quotes"],
      children: u.quoteMaterials
    },
    {
      key: "salesOrderLines",
      name: t`Sales Orders`,
      pages: ["sales.salesOrders"],
      children: u.salesOrderLines
    },
    {
      key: "shipmentLines",
      name: t`Shipments`,
      pages: ["inventory.shipments"],
      children: u.shipmentLines.map((shipment) => ({
        ...shipment,
        methodType: "Shipment"
      }))
    },
    {
      key: "supplierQuotes",
      name: t`Supplier Quotes`,
      pages: ["purchasing.supplierQuotes"],
      children: u.supplierQuotes
    }
  ];

  const referenced = tree.filter((node) => node.children.length > 0);

  return (
    <VStack spacing={1} className="w-full">
      <VStack spacing={0} className="min-w-0 px-1">
        <span className="truncate text-sm font-medium">
          {item.readableIdWithRevision}
        </span>
        {distinctItemText(item.readableIdWithRevision, item.itemName) && (
          <span className="truncate text-xs text-muted-foreground">
            {item.itemName}
          </span>
        )}
      </VStack>
      {referenced.length === 0 ? (
        <span className="px-1 text-xs text-muted-foreground italic">
          <Trans>Not referenced anywhere yet.</Trans>
        </span>
      ) : (
        <VStack spacing={0}>
          {referenced.map((node) => (
            <UsedInItem
              key={node.key}
              node={node}
              itemReadableIdWithRevision={item.readableIdWithRevision}
              filterText=""
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

// Change-order impact = where every affected item is used across the system.
// Read-only, informational — nothing here gates the release. Replaces the old
// jobs/sales/purchasing table with the richer part-page "Used In" tree so a
// single view answers "what does releasing this touch?".
export default function ImpactPanel({
  items,
  embedded = false
}: {
  items: ChangeNoticeImpactItem[];
  // When true, render without the Card chrome — the rail supplies the section
  // frame + title.
  embedded?: boolean;
}) {
  const body =
    items.length === 0 ? (
      <HStack spacing={2} className="text-sm text-muted-foreground">
        <LuCircleCheck className="size-4 shrink-0 text-emerald-500" />
        <Trans>No affected items to assess.</Trans>
      </HStack>
    ) : (
      <VStack spacing={4}>
        {items.map((item) => (
          <ImpactItem key={item.itemId} item={item} />
        ))}
      </VStack>
    );

  if (embedded) return body;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Impact</Trans>
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          <Trans>
            Where the affected items are used across the system. Informational —
            nothing here blocks releasing.
          </Trans>
        </span>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
