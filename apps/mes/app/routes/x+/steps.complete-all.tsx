// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { completeAllSteps } from "~/services/step-record.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  // Manager override: Jobs at Full, which operators lack. On a console the
  // pinned operator's grants decide (`authorize`).
  const { companyId, userId } = await authorize(request, {
    "production.jobs": "Full"
  });

  return completeAllSteps(
    { client: getCarbonServiceRole() },
    { request, companyId, userId }
  );
}
