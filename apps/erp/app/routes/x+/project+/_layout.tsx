// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import type { Handle } from "~/utils/handle";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Projects" }];
};

// No breadcrumb here: the detail route ($projectId.tsx) already emits the
// "Projects" list link via detailBreadcrumb, so declaring it on the layout too
// would render "Projects" twice. `module` keeps the navigation highlighted.
export const handle: Handle = {
  module: "projects"
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "projects"
  });

  return {};
}

export default function ProjectRoute() {
  return <RecordOutlet />;
}
