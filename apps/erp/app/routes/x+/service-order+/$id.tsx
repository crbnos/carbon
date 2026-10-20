// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useMatch, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getProjectElements } from "~/modules/projects";
import { ElementRoutesProvider } from "~/modules/projects/ui/Elements/ElementRoutes";
import type { ProjectTreeElement } from "~/modules/projects/ui/Project/ProjectElementTree";
import { getServiceOrder } from "~/modules/service";
import { ServiceOrderHeader } from "~/modules/service/ui/ServiceOrders";
import { ServiceOrderSidebar } from "~/modules/service/ui/ServiceOrders/ServiceOrderSidebar";
import { serviceOrderElementRoutes } from "~/modules/service/ui/Work/serviceElementRoutes";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Service Orders`, to: path.to.serviceOrders },
    (data) => data?.serviceOrder?.serviceOrderId
  ),
  module: "service"
};

const logger = getLogger("erp", "service-order");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceOrder = await getServiceOrder(client, id, companyId);
  if (serviceOrder.error) {
    throw redirect(
      path.to.serviceOrders,
      await flash(
        request,
        error(serviceOrder.error, "Failed to load service order")
      )
    );
  }

  // The coverage contracts the order may still name: its customer's Active
  // contracts. The unbilled count decides between Create Invoice and Close.
  const [contracts, unbilled, elements] = await Promise.all([
    serviceOrder.data.customerId
      ? client
          .from("customerContract")
          .select("id, customerContractId, name")
          .eq("companyId", companyId)
          .eq("customerId", serviceOrder.data.customerId)
          .eq("status", "Active")
          .order("customerContractId")
      : null,
    client
      .from("projectBillableItem")
      .select("id", { count: "exact", head: true })
      .eq("projectId", serviceOrder.data.projectId)
      .eq("companyId", companyId)
      .eq("status", "Unbilled"),
    // The work's element tree, for the sidebar under Work.
    getProjectElements(client, serviceOrder.data.projectId, companyId)
  ]);
  if (elements.error) {
    logger.error("Failed to load the work's elements", {
      companyId,
      serviceOrderId: id,
      error: elements.error
    });
  }
  const treeElements: ProjectTreeElement[] = (elements.data ?? []).map(
    (element) => ({
      id: element.id,
      parentId: element.parentId,
      sortOrder: element.sortOrder,
      readableId: element.readableId,
      name: element.name,
      type: element.type,
      sequence: element.sequence,
      wbsCode: element.wbsCode
    })
  );

  return {
    serviceOrder: serviceOrder.data,
    contracts: contracts?.data ?? [],
    unbilledCount: unbilled.count ?? 0,
    treeElements
  };
}

/**
 * The service order workspace, as the project workspace: the header, the
 * sidebar of page links (with the work's element tree under Work), and the
 * page. The order's editable fields are its Settings page.
 */
export default function ServiceOrderRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { serviceOrder } = useLoaderData<typeof loader>();
  // The Work list and the Overview lay themselves out, as the project's do.
  const isWork = useMatch(path.to.serviceOrderWork(id)) !== null;
  const isOverview = useMatch(path.to.serviceOrderDetails(id)) !== null;
  const routes = useMemo(
    () => serviceOrderElementRoutes(id, serviceOrder.projectId),
    [id, serviceOrder.projectId]
  );

  return (
    <PanelProvider>
      <ElementRoutesProvider routes={routes}>
        <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
          <ServiceOrderHeader />
          <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
            <div className="flex flex-grow overflow-hidden">
              <ResizablePanels
                explorerLabel={t`Service order`}
                explorer={<ServiceOrderSidebar />}
                content={
                  <div className="bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                    {isWork || isOverview ? (
                      <RecordOutlet />
                    ) : (
                      <VStack
                        spacing={8}
                        className="mx-auto w-full max-w-[64rem] px-6 py-8"
                      >
                        <RecordOutlet />
                      </VStack>
                    )}
                  </div>
                }
              />
            </div>
          </div>
        </div>
      </ElementRoutesProvider>
    </PanelProvider>
  );
}
