// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ActionFunctionArgs } from "react-router";
import { createPeriodRun } from "~/routes/x+/accounting+/period-runs.server";

export async function action(args: ActionFunctionArgs) {
  return createPeriodRun(args, "Revenue Recognition");
}
