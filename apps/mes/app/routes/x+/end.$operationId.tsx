// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import type { LoaderFunctionArgs } from "react-router";
import { erpPosting } from "~/services/erp";
import { endOperationByScan } from "~/services/kanban-scan.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Writes on GET: a link on another site must not trigger it.
  rejectCrossSiteNavigation(request);
  const { userId, companyId } = await authorize(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  return endOperationByScan(
    { client: getCarbonServiceRole(), post: erpPosting },
    { request, companyId, userId, operationId }
  );
}
