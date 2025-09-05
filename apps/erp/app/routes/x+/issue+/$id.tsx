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
  getInvestigationTypesList,
  getIssue,
  getIssueAssociations,
  getIssueTypesList,
  getRequiredActionsList,
} from "~/modules/quality";
import type { IssueAssociationNode } from "~/modules/quality/types";
import {
  IssueAssociationsSkeleton,
  IssueAssociationsTree,
} from "~/modules/quality/ui/Issue/IssueAssociations";
import IssueHeader from "~/modules/quality/ui/Issue/IssueHeader";
import IssueProperties from "~/modules/quality/ui/Issue/IssueProperties";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Issues",
  to: path.to.issues,
  module: "quality",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    nonConformance,
    nonConformanceTypes,
    investigationTypes,
    requiredActions,
    tags,
  ] = await Promise.all([
    getIssue(client, id),
    getIssueTypesList(client, companyId),
    getInvestigationTypesList(client, companyId),
    getRequiredActionsList(client, companyId),
    getTagsList(client, companyId, "nonConformance"),
  ]);

  if (nonConformance.error) {
    throw redirect(
      path.to.issues,
      await flash(request, error(nonConformance.error, "Failed to load issue"))
    );
  }

  return defer({
    nonConformance: nonConformance.data,
    nonConformanceTypes: nonConformanceTypes.data ?? [],
    investigationTypes: investigationTypes.data ?? [],
    requiredActions: requiredActions.data ?? [],
    files: getItemFiles(client, id, companyId),
    associations: getIssueAssociations(client, id, companyId),
    tags: tags.data ?? [],
  });
}

export default function IssueRoute() {
  const { associations } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <IssueHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <Suspense fallback={<IssueAssociationsSkeleton />}>
                  <Await resolve={associations}>
                    {(resolvedAssociations) => {
                      // Transform the raw associations data into the tree structure expected by IssueAssociationsTree
                      const tree: IssueAssociationNode[] = [
                        {
                          key: "items",
                          name: "Item",
                          pluralName: "Items",
                          module: "parts",
                          children: resolvedAssociations.items,
                        },
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
                        <IssueAssociationsTree
                          tree={tree}
                          nonConformanceId={id}
                          items={
                            resolvedAssociations.items?.map(
                              (i) => i.documentId
                            ) ?? undefined
                          }
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
              properties={<IssueProperties />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
