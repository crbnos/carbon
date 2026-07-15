import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getChangeOrdersForNonConformance,
  getItemFiles
} from "~/modules/items";
import {
  getIssue,
  getIssueAssociations,
  getIssueSuppliers,
  getIssueTypesList,
  getRequiredActionsList
} from "~/modules/quality";
import type { IssueAssociationNode } from "~/modules/quality/types";
import {
  IssueAssociationsSkeleton,
  IssueAssociationsTree
} from "~/modules/quality/ui/Issue/IssueAssociations";
import IssueHeader from "~/modules/quality/ui/Issue/IssueHeader";
import IssueProperties from "~/modules/quality/ui/Issue/IssueProperties";
import { getTagsList } from "~/modules/shared";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Issues`, to: path.to.issues },
    (data) => data?.nonConformance?.nonConformanceId
  ),
  module: "quality"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    nonConformance,
    nonConformanceTypes,
    requiredActions,
    suppliers,
    tags,
    changeOrders
  ] = await Promise.all([
    getIssue(client, id),
    getIssueTypesList(client, companyId),
    getRequiredActionsList(client, companyId),
    getIssueSuppliers(client, id, companyId),
    getTagsList(client, companyId, "nonConformance"),
    // Reverse Linked-NCR cross-link (4a): COs referencing this issue.
    getChangeOrdersForNonConformance(client, id, companyId)
  ]);

  if (nonConformance.error) {
    throw redirect(
      path.to.issues,
      await flash(request, error(nonConformance.error, "Failed to load issue"))
    );
  }

  return {
    associations: getIssueAssociations(client, id, companyId),
    files: getItemFiles(client, id, companyId),
    nonConformance: nonConformance.data,
    nonConformanceTypes: nonConformanceTypes.data ?? [],
    requiredActions: requiredActions.data ?? [],
    suppliers: suppliers.data ?? [],
    tags: tags.data ?? [],
    changeOrders: changeOrders.data ?? []
  };
}

export default function IssueRoute() {
  const { t } = useLingui();
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
                          name: t`Item`,
                          pluralName: t`Items`,
                          module: "parts",
                          children: resolvedAssociations.items
                        },
                        {
                          key: "jobOperations",
                          name: t`Job Operation`,
                          pluralName: t`Job Operations`,
                          module: "production",
                          children: resolvedAssociations.jobOperations
                        },
                        {
                          key: "purchaseOrderLines",
                          name: t`Purchase Order`,
                          pluralName: t`Purchase Orders`,
                          module: "purchasing",
                          children: resolvedAssociations.purchaseOrderLines
                        },
                        {
                          key: "salesOrderLines",
                          name: t`Sales Order`,
                          pluralName: t`Sales Orders`,
                          module: "sales",
                          children: resolvedAssociations.salesOrderLines
                        },
                        {
                          key: "shipmentLines",
                          name: t`Shipment`,
                          pluralName: t`Shipments`,
                          module: "shipping",
                          children: resolvedAssociations.shipmentLines
                        },
                        {
                          key: "receiptLines",
                          name: t`Receipt`,
                          pluralName: t`Receipts`,
                          module: "receiving",
                          children: resolvedAssociations.receiptLines
                        },
                        {
                          key: "trackedEntities",
                          name: t`Tracked Entity`,
                          pluralName: t`Tracked Entities`,
                          module: "inventory",
                          children: resolvedAssociations.trackedEntities
                        },
                        {
                          key: "customers",
                          name: t`Customer`,
                          pluralName: t`Customers`,
                          module: "sales",
                          children: resolvedAssociations.customers
                        },
                        {
                          key: "suppliers",
                          name: t`Supplier`,
                          pluralName: t`Suppliers`,
                          module: "purchasing",
                          children: resolvedAssociations.suppliers
                        },
                        {
                          key: "inboundInspections",
                          name: t`Inbound Inspection`,
                          pluralName: t`Inbound Inspections`,
                          module: "quality",
                          children:
                            (resolvedAssociations as any).inboundInspections ??
                            []
                        }
                      ];
                      return (
                        <IssueAssociationsTree
                          tree={tree}
                          nonConformanceId={id}
                          items={
                            resolvedAssociations.items?.map(
                              (i: any) => i.documentId
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
              properties={<IssueProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
