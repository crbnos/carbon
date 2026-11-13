// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { projectsSidebarCounts } from "~/modules/projects/projects.service";
import type { Handle } from "~/utils/handle";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Projects" }];
};

// No breadcrumb here: the detail route ($projectId.tsx) already emits the
// "Projects" list link via detailBreadcrumb, so declaring it on the layout too
// would render "Projects" twice.
export const handle: Handle = {};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, permissions } = await authorize(request, {
    "projects.projects": "View"
  });
  return projectsSidebarCounts(client, { companyId, permissions });
}

export default function ProjectRoute() {
  return <RecordOutlet />;
}
