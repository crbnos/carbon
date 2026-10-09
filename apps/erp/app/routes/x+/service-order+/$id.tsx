// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getServiceOrder } from "~/modules/service";
import {
  ServiceOrderHeader,
  ServiceOrderProperties
} from "~/modules/service/ui/ServiceOrders";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Service Orders`, to: path.to.serviceOrders },
    (data) => data?.serviceOrder?.serviceOrderId
  ),
  module: "service"
};

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
  // contracts.
  const contracts = serviceOrder.data.customerId
    ? await client
        .from("customerContract")
        .select("id, customerContractId, name")
        .eq("companyId", companyId)
        .eq("customerId", serviceOrder.data.customerId)
        .eq("status", "Active")
        .order("customerContractId")
    : null;

  return {
    serviceOrder: serviceOrder.data,
    contracts: contracts?.data ?? []
  };
}

export default function ServiceOrderRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <ServiceOrderHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<ServiceOrderProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
