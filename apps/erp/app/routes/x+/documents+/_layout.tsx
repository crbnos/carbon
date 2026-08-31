import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import {
  CollapsibleSidebarProvider,
  ContentSidebar
} from "~/components/Layout/Navigation";
import { useDocumentsSubmodules } from "~/modules/documents";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Documents" }];
};

export const handle: Handle = {
  breadcrumb: msg`Documents`,
  to: path.to.documents,
  module: "documents"
};

export default function DocumentsRoute() {
  const { links } = useDocumentsSubmodules();

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] w-full h-full">
        <ContentSidebar links={links} />
        <VStack spacing={0} className="h-full">
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
