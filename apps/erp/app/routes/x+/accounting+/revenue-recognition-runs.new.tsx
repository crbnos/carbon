// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { projectRevenueSynthesizers } from "@carbon/ee/project-revenue.server";
import type { ActionFunctionArgs } from "react-router";
import { proposePeriodRun } from "~/modules/accounting/period-runs.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  return proposePeriodRun(
    request,
    "Revenue Recognition",
    projectRevenueSynthesizers
  );
}
