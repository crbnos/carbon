import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import { ResizablePanels } from "~/components/Layout";

import { requirePermissions } from "@carbon/auth/auth.server";
import { useRouteData } from "@carbon/remix";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer } from "@vercel/remix";
import { Suspense } from "react";
import type { ItemFile, MaterialSummary } from "~/modules/items";
import { getMaterialUsedIn } from "~/modules/items";
import type { UsedInNode } from "~/modules/items/ui/Item/UsedIn";
import { UsedInSkeleton, UsedInTree } from "~/modules/items/ui/Item/UsedIn";
import MaterialProperties from "~/modules/items/ui/Materials/MaterialProperties";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true,
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  return defer({ usedIn: getMaterialUsedIn(client, itemId, companyId) });
}

export default function MaterialViewRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const materialData = useRouteData<{
    materialSummary: MaterialSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.material(itemId));

  if (!materialData) throw new Error("Could not find material data");

  const { usedIn } = useLoaderData<typeof loader>();

  return (
    <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
      <div className="flex flex-grow overflow-hidden">
        <ResizablePanels
          explorer={
            <Suspense fallback={<UsedInSkeleton />}>
              <Await resolve={usedIn}>
                {(resolvedUsedIn) => {
                  const {
                    jobMaterials,

                    methodMaterials,
                    purchaseOrderLines,
                    receiptLines,

                    quoteMaterials,
                    salesOrderLines,
                    shipmentLines,
                    supplierQuotes,
                  } = resolvedUsedIn;

                  const tree: UsedInNode[] = [
                    {
                      key: "jobMaterials",
                      name: "Job Materials",
                      module: "production",
                      children: jobMaterials,
                    },
                    {
                      key: "methodMaterials",
                      name: "Method Materials",
                      module: "parts",
                      // @ts-expect-error
                      children: methodMaterials,
                    },
                    {
                      key: "purchaseOrderLines",
                      name: "Purchase Orders",
                      module: "purchasing",
                      children: purchaseOrderLines.map((po) => ({
                        ...po,
                        methodType: "Buy",
                      })),
                    },
                    {
                      key: "receiptLines",
                      name: "Receipts",
                      module: "inventory",
                      children: receiptLines.map((receipt) => ({
                        ...receipt,
                        methodType: "Pick",
                      })),
                    },

                    {
                      key: "quoteMaterials",
                      name: "Quote Materials",
                      module: "sales",
                      children: quoteMaterials?.map((qm) => ({
                        ...qm,
                        documentReadableId: qm.documentReadableId ?? "",
                      })),
                    },
                    {
                      key: "salesOrderLines",
                      name: "Sales Orders",
                      module: "sales",
                      children: salesOrderLines,
                    },
                    {
                      key: "shipmentLines",
                      name: "Shipments",
                      module: "inventory",
                      children: shipmentLines.map((shipment) => ({
                        ...shipment,
                        methodType: "Shipment",
                      })),
                    },
                    {
                      key: "supplierQuotes",
                      name: "Supplier Quotes",
                      module: "purchasing",
                      children: supplierQuotes,
                    },
                  ];

                  return (
                    <UsedInTree
                      tree={tree}
                      hasSizesInsteadOfRevisions={true}
                      revisions={materialData.materialSummary?.revisions}
                      itemReadableId={
                        materialData.materialSummary?.readableId ?? ""
                      }
                      itemReadableIdWithRevision={
                        materialData.materialSummary?.readableIdWithRevision ??
                        ""
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
          properties={<MaterialProperties />}
        />
      </div>
    </div>
  );
}
