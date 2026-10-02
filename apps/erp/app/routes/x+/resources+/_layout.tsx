// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { useResourcesSubmodules } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Resources" }];
};

function ResourcesSidebar() {
  const { groups } = useResourcesSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Resources`,
  to: path.to.resources,
  module: "resources",
  sidebar: ResourcesSidebar
};

export default function ResourcesRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <Outlet />
    </VStack>
  );
}
