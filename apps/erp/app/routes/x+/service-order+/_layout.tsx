// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import type { Handle } from "~/utils/handle";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Service Order" }];
};

// No breadcrumb here: the order route ($id.tsx) emits the "Service Orders"
// list link through detailBreadcrumb. `module` keeps the navigation
// highlighted.
export const handle: Handle = {
  module: "service"
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "service"
  });

  return {};
}

export default function ServiceOrderRoute() {
  return <RecordOutlet />;
}
