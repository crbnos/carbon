import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import useWorkflowsSubmodules from "~/modules/workflows/ui/useWorkflowsSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Workflows" }];
};

export const handle: Handle = {
  breadcrumb: msg`Workflows`,
  to: path.to.workflows,
  module: "workflows"
};

export default function WorkflowsRoute() {
  const { groups } = useWorkflowsSubmodules();

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] w-full h-full">
        <GroupedContentSidebar groups={groups} />
        <VStack spacing={0} className="h-full">
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
