import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import useAccountSubmodules from "~/modules/account/ui/useAccountSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | My Account" }];
};

export const handle: Handle = {
  breadcrumb: msg`Account`,
  to: path.to.profile,
  module: "account"
};

export default function AccountRoute() {
  const { groups } = useAccountSubmodules();

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_1fr] w-full h-full bg-card">
        <GroupedContentSidebar groups={groups} />
        <VStack
          spacing={0}
          className="overflow-y-auto scrollbar-hide h-[calc(100dvh-49px)]"
        >
          <VStack
            spacing={4}
            className="py-12 px-4 max-w-[60rem] h-full mx-auto"
          >
            <Outlet />
          </VStack>
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
