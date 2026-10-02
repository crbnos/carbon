// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { ContentSidebar } from "~/components/Layout/Navigation";
import { useDocumentsSubmodules } from "~/modules/documents";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Documents" }];
};

function DocumentsSidebar() {
  const { links } = useDocumentsSubmodules();
  return <ContentSidebar links={links} />;
}

export const handle: Handle = {
  breadcrumb: msg`Documents`,
  to: path.to.documents,
  module: "documents",
  sidebar: DocumentsSidebar
};

export default function DocumentsRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <Outlet />
    </VStack>
  );
}
