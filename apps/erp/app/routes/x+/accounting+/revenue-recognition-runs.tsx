// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { loadPeriodRuns } from "~/modules/accounting/period-runs.server";
import { PeriodRunsPage } from "~/modules/accounting/ui/RevenueRecognition";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Revenue Recognition`,
  to: path.to.revenueRecognitionRuns
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadPeriodRuns(request, "Revenue Recognition");
}

export default function RevenueRecognitionRunsRoute() {
  const data = useLoaderData<typeof loader>();
  return <PeriodRunsPage type="Revenue Recognition" {...data} />;
}
