import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getItemFiles } from "~/modules/items";
import {
  getNonConformance,
  getNonConformanceAssociations,
  getNonConformanceTypesList,
} from "~/modules/quality";
import type { NonConformanceAssociationNode } from "~/modules/quality/ui/NonConformance/NonConformanceAssociations";
import {
  NonConformanceAssociationsSkeleton,
  NonConformanceAssociationsTree,
} from "~/modules/quality/ui/NonConformance/NonConformanceAssociations";
import NonConformanceHeader from "~/modules/quality/ui/NonConformance/NonConformanceHeader";
import NonConformanceProperties from "~/modules/quality/ui/NonConformance/NonConformanceProperties";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Non-Conformances",
  to: path.to.nonConformances,
  module: "quality",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [nonConformance, nonConformanceTypes, tags] = await Promise.all([
    getNonConformance(client, id),
    getNonConformanceTypesList(client, companyId),
    getTagsList(client, companyId, "nonConformance"),
  ]);

  if (nonConformance.error) {
    throw redirect(
      path.to.nonConformances,
      await flash(
        request,
        error(nonConformance.error, "Failed to load non-conformance")
      )
    );
  }

  return defer({
    nonConformance: nonConformance.data,
    nonConformanceTypes: nonConformanceTypes.data ?? [],
    files: getItemFiles(client, id, companyId),
    associations: getNonConformanceAssociations(client, id, companyId),
    tags: tags.data ?? [],
  });
}

export default function NonConformanceRoute() {
  const { associations } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <NonConformanceHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <Suspense fallback={<NonConformanceAssociationsSkeleton />}>
                  <Await resolve={associations}>
                    {(resolvedAssociations) => {
                      // Transform the raw associations data into the tree structure expected by NonConformanceAssociationsTree
                      const tree: NonConformanceAssociationNode[] = [
                        {
                          key: "jobOperations",
                          name: "Job Operation",
                          pluralName: "Job Operations",
                          module: "production",
                          children: resolvedAssociations.jobOperations,
                        },
                        {
                          key: "purchaseOrderLines",
                          name: "Purchase Order",
                          pluralName: "Purchase Orders",
                          module: "purchasing",
                          children: resolvedAssociations.purchaseOrderLines,
                        },
                        {
                          key: "salesOrderLines",
                          name: "Sales Order",
                          pluralName: "Sales Orders",
                          module: "sales",
                          children: resolvedAssociations.salesOrderLines,
                        },
                        {
                          key: "shipmentLines",
                          name: "Shipment",
                          pluralName: "Shipments",
                          module: "shipping",
                          children: resolvedAssociations.shipmentLines,
                        },
                        {
                          key: "receiptLines",
                          name: "Receipt",
                          pluralName: "Receipts",
                          module: "receiving",
                          children: resolvedAssociations.receiptLines,
                        },
                        {
                          key: "trackedEntities",
                          name: "Tracked Entity",
                          pluralName: "Tracked Entities",
                          module: "inventory",
                          children: resolvedAssociations.trackedEntities,
                        },
                        {
                          key: "customers",
                          name: "Customer",
                          pluralName: "Customers",
                          module: "sales",
                          children: resolvedAssociations.customers,
                        },
                        {
                          key: "suppliers",
                          name: "Supplier",
                          pluralName: "Suppliers",
                          module: "purchasing",
                          children: resolvedAssociations.suppliers,
                        },
                      ];
                      return (
                        <NonConformanceAssociationsTree
                          tree={tree}
                          nonConformanceId={id}
                        />
                      );
                    }}
                  </Await>
                </Suspense>
              }
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<NonConformanceProperties />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
