import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import { LuKey } from "react-icons/lu";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { usePermissions } from "~/hooks";
import { useSettingsSubmodules } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Settings" }];
};

export const handle: Handle = {
  breadcrumb: "Settings",
  to: path.to.company,
  module: "settings",
};

export const config = {
  runtime: "nodejs",
};

export default function SettingsRoute() {
  const permissions = usePermissions();
  const { groups } = useSettingsSubmodules();

  if (permissions.can("update", "users") && permissions.is("employee")) {
    groups?.[2]?.routes.unshift({
      name: "API Keys",
      to: path.to.apiKeys,
      role: "employee",
      icon: <LuKey />,
    });
  }

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_1fr] w-full h-full bg-card">
        <GroupedContentSidebar groups={groups} />
        <VStack
          spacing={0}
          className="overflow-y-auto scrollbar-hide h-[calc(100dvh-49px)]"
        >
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
