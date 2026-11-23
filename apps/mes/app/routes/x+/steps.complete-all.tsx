// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { completeAllSteps } from "~/services/step-record.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  // Manager override — gated on the Production DELETE permission (operators lack it).
  const { companyId, userId } = await requirePermissions(request, {
    delete: "production"
  });

  return completeAllSteps(
    { client: getCarbonServiceRole() },
    { request, companyId, userId }
  );
}
