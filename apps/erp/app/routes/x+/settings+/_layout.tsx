import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { useSettingsSubmodules } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Settings" }];
};

export const handle: Handle = {
  breadcrumb: msg`Settings`,
  to: path.to.company,
  module: "settings"
};

export default function SettingsRoute() {
  const { groups } = useSettingsSubmodules();

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] w-full h-full bg-card">
        <GroupedContentSidebar groups={groups} />
        <VStack
          spacing={0}
          className="overflow-y-auto scrollbar-hide h-[calc(100dvh-var(--topbar-height))]"
        >
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
