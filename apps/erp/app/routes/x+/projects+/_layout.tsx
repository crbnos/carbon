// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";

import { GroupedContentSidebar } from "~/components/Layout";
import useProjectsSubmodules from "~/modules/projects/ui/useProjectsSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Projects" }];
};

function ProjectsSidebar() {
  const { groups } = useProjectsSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Projects`,
  to: path.to.projects,
  module: "projects",
  sidebar: ProjectsSidebar
};

export default function ProjectsRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <RecordOutlet />
    </VStack>
  );
}
