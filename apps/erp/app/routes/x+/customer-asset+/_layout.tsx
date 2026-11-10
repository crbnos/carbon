// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import type { Handle } from "~/utils/handle";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Customer Asset" }];
};

// No breadcrumb here: the asset route emits the "Customer Assets" list link
// through detailBreadcrumb.
export const handle: Handle = {
  module: "service"
};

// The only check on this layout's own URL, which has no index route; the
// children gate themselves.
export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { "service.customerAssets": "View" });

  return {};
}

export default function CustomerAssetLayout() {
  return <RecordOutlet />;
}
