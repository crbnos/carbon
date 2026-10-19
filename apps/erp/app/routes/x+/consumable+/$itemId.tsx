// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dataOrThrow } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ITEM_PAGES } from "@carbon/database/access";
import { RecordOutlet, useRouteData } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useParams } from "react-router";
import { ResizablePanels } from "~/components/Layout";
import { streamItemSupersession } from "~/modules/items/items.service";
import type { ConsumableSummary, ItemFile } from "~/modules/items/types";
import {
  ConsumableHeader,
  ConsumableProperties
} from "~/modules/items/ui/Consumables";
import type { UsedInNode } from "~/modules/items/ui/Item/UsedIn";
import { UsedInSkeleton, UsedInTree } from "~/modules/items/ui/Item/UsedIn";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Consumables`, to: path.to.consumables },
    (data) => data?.consumableSummary?.readableIdWithRevision
  ),
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(
    request,
    { "parts.consumables": "View" },
    { bypassRls: true }
  );

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const { supersession, supersededBy } = streamItemSupersession(
    client,
    itemId,
    companyId
  );

  const [consumableSummary, supplierParts, pickMethods, tags] =
    await Promise.all([
      api.items.getConsumable({ itemId }),
      api.items.getSupplierParts({ id: itemId }),
      api.items.getPickMethods({ itemId }),
      api.shared.getTagsList({ table: "consumable" })
    ]);

  if (consumableSummary.error) {
    throw redirect(
      path.to.consumables,
      await flash(
        request,
        error(consumableSummary.error, "Failed to load consumable summary")
      )
    );
  }

  return {
    consumableSummary: consumableSummary.data,
    supersession,
    supersededBy,
    files: api.items.getItemFiles({ itemId }).then(dataOrThrow),
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
    usedIn: api.items.getMaterialUsedIn({ itemId }).then(dataOrThrow)
  };
}

export default function ConsumableRoute() {
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const consumableData = useRouteData<{
    consumableSummary: ConsumableSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.consumable(itemId));

  if (!consumableData) throw new Error("Could not find consumable data");

  const { usedIn } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
      <ConsumableHeader key={itemId} />
      <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
        <div className="flex flex-grow overflow-hidden">
          <ResizablePanels
            explorerLabel={t`Used In`}
            explorer={
              <div className="flex flex-col h-full">
                <div className="flex-1 overflow-y-auto">
                  <Suspense fallback={<UsedInSkeleton />}>
                    <Await resolve={usedIn}>
                      {(resolvedUsedIn) => {
                        const {
                          issues,
                          jobMaterials,
                          maintenanceDispatchItems,
                          methodMaterials,
                          purchaseOrderLines,
                          receiptLines,
                          quoteMaterials,
                          salesOrderLines,
                          shipmentLines,
                          supplierQuotes,
                          inspections,
                          jobMaterialUsage
                        } = resolvedUsedIn;

                        const tree: UsedInNode[] = [
                          {
                            key: "issues",
                            name: "Issues",
                            pages: ["quality.issues"],
                            children: issues
                          },
                          {
                            key: "jobMaterials",
                            name: "Job Materials",
                            pages: ["production.jobs"],
                            children: jobMaterials
                          },
                          {
                            key: "maintenanceDispatchItems",
                            name: "Maintenance",
                            pages: ["resources.dispatches"],
                            children: maintenanceDispatchItems
                          },
                          {
                            key: "methodMaterials",
                            name: "Method Materials",
                            pages: ITEM_PAGES,
                            // @ts-expect-error
                            children: methodMaterials
                          },
                          {
                            key: "purchaseOrderLines",
                            name: "Purchase Orders",
                            pages: ["purchasing.purchaseOrders"],
                            children: purchaseOrderLines.map((po) => ({
                              ...po,
                              methodType: "Purchase to Order"
                            }))
                          },
                          {
                            key: "receiptLines",
                            name: "Receipts",
                            pages: ["inventory.receipts"],
                            children: receiptLines.map((receipt) => ({
                              ...receipt,
                              methodType: "Pull from Inventory"
                            }))
                          },

                          {
                            key: "quoteMaterials",
                            name: "Quote Materials",
                            pages: ["sales.quotes"],
                            children: quoteMaterials?.map((qm) => ({
                              ...qm,
                              documentReadableId: qm.documentReadableId ?? ""
                            }))
                          },
                          {
                            key: "salesOrderLines",
                            name: "Sales Orders",
                            pages: ["sales.salesOrders"],
                            children: salesOrderLines
                          },
                          {
                            key: "shipmentLines",
                            name: "Shipments",
                            pages: ["inventory.shipments"],
                            children: shipmentLines.map((shipment) => ({
                              ...shipment,
                              methodType: "Shipment"
                            }))
                          },
                          {
                            key: "supplierQuotes",
                            name: "Supplier Quotes",
                            pages: ["purchasing.supplierQuotes"],
                            children: supplierQuotes
                          }
                        ];

                        tree.push({
                          key: "inspections",
                          name: "Inspections",
                          pages: ["quality.inspections"],
                          children: inspections
                        });

                        return (
                          <UsedInTree
                            tree={tree}
                            revisions={
                              consumableData.consumableSummary?.revisions
                            }
                            itemReadableId={
                              consumableData.consumableSummary?.readableId ?? ""
                            }
                            itemReadableIdWithRevision={
                              consumableData.consumableSummary
                                ?.readableIdWithRevision ?? ""
                            }
                            jobMaterialUsage={jobMaterialUsage}
                          />
                        );
                      }}
                    </Await>
                  </Suspense>
                </div>
              </div>
            }
            content={
              <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                <RecordOutlet />
              </div>
            }
            properties={<ConsumableProperties key={itemId} />}
          />
        </div>
      </div>
    </div>
  );
}
