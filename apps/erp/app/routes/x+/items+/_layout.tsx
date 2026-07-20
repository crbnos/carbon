import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet, useMatches } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import useItemsSubmodules from "~/modules/items/ui/useItemsSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Items" }];
};

export const handle: Handle = {
  breadcrumb: msg`Items`,
  to: path.to.parts,
  module: "items"
};

export default function PartsRoute() {
  const { groups } = useItemsSubmodules();
  // A full-screen detail view (the change-order workspace) can opt out of the
  // module sidebar via its route handle so we don't stack two left sidebars.
  const matches = useMatches();
  const hideSidebar = matches.some(
    (m) => (m.handle as Handle | undefined)?.hideModuleSidebar
  );

  return (
    <CollapsibleSidebarProvider>
      <div
        className={
          hideSidebar
            ? "w-full h-full"
            : "grid grid-cols-[auto_1fr] w-full h-full"
        }
      >
        {!hideSidebar && <GroupedContentSidebar groups={groups} />}
        <VStack spacing={0} className="h-full">
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
