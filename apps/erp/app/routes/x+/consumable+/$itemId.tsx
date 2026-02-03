import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useRouteData } from "@carbon/remix";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { ResizablePanels } from "~/components/Layout";
import type { ConsumableSummary, ItemFile } from "~/modules/items";
import {
  getConsumable,
  getItemFiles,
  getMaterialUsedIn,
  getPickMethods,
  getSupplierParts
} from "~/modules/items";
import {
  ConsumableHeader,
  ConsumableProperties
} from "~/modules/items/ui/Consumables";
import type { UsedInNode } from "~/modules/items/ui/Item/UsedIn";
import { UsedInSkeleton, UsedInTree } from "~/modules/items/ui/Item/UsedIn";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Consumables",
  to: path.to.consumables,
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [consumableSummary, supplierParts, pickMethods, tags] =
    await Promise.all([
      getConsumable(client, itemId, companyId),
      getSupplierParts(client, itemId, companyId),
      getPickMethods(client, itemId, companyId),
      getTagsList(client, companyId, "consumable")
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
    files: getItemFiles(client, itemId, companyId),
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
    usedIn: getMaterialUsedIn(client, itemId, companyId)
  };
}

export default function ConsumableRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const consumableData = useRouteData<{
    consumableSummary: ConsumableSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.consumable(itemId));

  if (!consumableData) throw new Error("Could not find consumable data");

  const { usedIn } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <ConsumableHeader />
      <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
        <div className="flex flex-grow overflow-hidden">
          <ResizablePanels
            explorer={
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
                      supplierQuotes
                    } = resolvedUsedIn;

                    const tree: UsedInNode[] = [
                      {
                        key: "issues",
                        name: "Issues",
                        module: "quality",
                        children: issues
                      },
                      {
                        key: "jobMaterials",
                        name: "Job Materials",
                        module: "production",
                        children: jobMaterials
                      },
                      {
                        key: "maintenanceDispatchItems",
                        name: "Maintenance",
                        module: "resources",
                        children: maintenanceDispatchItems
                      },
                      {
                        key: "methodMaterials",
                        name: "Method Materials",
                        module: "parts",
                        // @ts-expect-error
                        children: methodMaterials
                      },
                      {
                        key: "purchaseOrderLines",
                        name: "Purchase Orders",
                        module: "purchasing",
                        children: purchaseOrderLines.map((po) => ({
                          ...po,
                          methodType: "Buy"
                        }))
                      },
                      {
                        key: "receiptLines",
                        name: "Receipts",
                        module: "inventory",
                        children: receiptLines.map((receipt) => ({
                          ...receipt,
                          methodType: "Pick"
                        }))
                      },

                      {
                        key: "quoteMaterials",
                        name: "Quote Materials",
                        module: "sales",
                        children: quoteMaterials?.map((qm) => ({
                          ...qm,
                          documentReadableId: qm.documentReadableId ?? ""
                        }))
                      },
                      {
                        key: "salesOrderLines",
                        name: "Sales Orders",
                        module: "sales",
                        children: salesOrderLines
                      },
                      {
                        key: "shipmentLines",
                        name: "Shipments",
                        module: "inventory",
                        children: shipmentLines.map((shipment) => ({
                          ...shipment,
                          methodType: "Shipment"
                        }))
                      },
                      {
                        key: "supplierQuotes",
                        name: "Supplier Quotes",
                        module: "purchasing",
                        children: supplierQuotes
                      }
                    ];

                    return (
                      <UsedInTree
                        tree={tree}
                        revisions={consumableData.consumableSummary?.revisions}
                        itemReadableId={
                          consumableData.consumableSummary?.readableId ?? ""
                        }
                        itemReadableIdWithRevision={
                          consumableData.consumableSummary
                            ?.readableIdWithRevision ?? ""
                        }
                      />
                    );
                  }}
                </Await>
              </Suspense>
            }
            content={
              <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                <Outlet />
              </div>
            }
            properties={<ConsumableProperties />}
          />
        </div>
      </div>
    </div>
  );
}
