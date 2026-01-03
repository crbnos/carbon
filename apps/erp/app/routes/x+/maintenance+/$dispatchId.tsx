import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { type JSONContent, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import RiskRegisterCard from "~/modules/quality/ui/RiskRegister/RiskRegisterCard";
import {
  getFailureModesList,
  getMaintenanceDispatch,
  getMaintenanceDispatchComments,
  getMaintenanceDispatchEvents,
  getMaintenanceDispatchItems
} from "~/modules/resources";
import { MaintenanceDispatchExplorer } from "~/modules/resources/ui/Maintenance/MaintenanceDispatchExplorer";
import MaintenanceDispatchHeader from "~/modules/resources/ui/Maintenance/MaintenanceDispatchHeader";
import {
  MaintenanceDispatchFiles,
  MaintenanceDispatchNotes
} from "~/modules/resources/ui/Maintenance/MaintenanceDispatchNotes";
import MaintenanceDispatchProperties from "~/modules/resources/ui/Maintenance/MaintenanceDispatchProperties";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Maintenance",
  to: path.to.maintenanceDispatches,
  module: "resources"
};

async function getMaintenanceDispatchFiles(
  client: Parameters<typeof getMaintenanceDispatch>[0],
  companyId: string,
  dispatchId: string
) {
  const result = await client.storage
    .from("private")
    .list(`${companyId}/maintenance/${dispatchId}`);
  return result.data || [];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources"
  });

  const { dispatchId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");

  const [dispatch, events, items, comments, failureModes] = await Promise.all([
    getMaintenanceDispatch(client, dispatchId),
    getMaintenanceDispatchEvents(client, dispatchId),
    getMaintenanceDispatchItems(client, dispatchId),
    getMaintenanceDispatchComments(client, dispatchId),
    getFailureModesList(client, companyId)
  ]);

  if (dispatch.error) {
    throw redirect(
      path.to.maintenanceDispatches,
      await flash(
        request,
        error(dispatch.error, "Failed to load maintenance dispatch")
      )
    );
  }

  return {
    dispatch: dispatch.data,
    events: events.data ?? [],
    items: items.data ?? [],
    comments: comments.data ?? [],
    failureModes: failureModes.data ?? [],
    files: getMaintenanceDispatchFiles(client, companyId, dispatchId)
  };
}

export default function MaintenanceDispatchRoute() {
  const { dispatchId } = useParams();
  const { dispatch, events, items, files } = useLoaderData<typeof loader>();

  if (!dispatchId) throw new Error("Could not find dispatchId");

  const isCompleted = dispatch?.status === "Completed";

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <MaintenanceDispatchHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <MaintenanceDispatchExplorer items={items} events={events} />
              }
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <MaintenanceDispatchNotes
                      id={dispatchId}
                      content={(dispatch?.content ?? {}) as JSONContent}
                      isDisabled={isCompleted}
                    />
                    <MaintenanceDispatchFiles
                      dispatchId={dispatchId}
                      files={files}
                      isDisabled={isCompleted}
                    />
                    {dispatch?.workCenterId && (
                      <RiskRegisterCard
                        sourceId={dispatch.workCenterId}
                        source="Work Center"
                      />
                    )}
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<MaintenanceDispatchProperties />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
