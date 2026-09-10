import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { useUsersSubmodules } from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Users" }];
};

export const handle: Handle = {
  breadcrumb: msg`Users`,
  to: path.to.employeeAccounts,
  module: "users"
};

export default function UsersRoute() {
  const { groups } = useUsersSubmodules();

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
