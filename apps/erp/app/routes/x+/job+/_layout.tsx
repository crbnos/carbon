// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";

import type { Handle } from "~/utils/handle";
import { moduleMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta = moduleMeta("Jobs");

export const handle: Handle = {
  breadcrumb: msg`Production`,
  to: path.to.production,
  module: "production"
};

// The only check on this layout's own URL, which has no index route; the
// children gate themselves.
export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { "production.jobs": "View" });

  return {};
}

export default function JobRoute() {
  return <RecordOutlet />;
}
