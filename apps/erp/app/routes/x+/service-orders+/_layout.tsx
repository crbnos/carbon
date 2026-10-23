// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { GroupedContentSidebar } from "~/components/Layout";
import useServiceSubmodules from "~/modules/service/ui/useServiceSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Service" }];
};

function ServiceSidebar() {
  const { groups } = useServiceSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Service`,
  to: path.to.serviceJobs,
  module: "service",
  sidebar: ServiceSidebar
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "service"
  });

  return {};
}

export default function ServiceRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <RecordOutlet />
    </VStack>
  );
}
