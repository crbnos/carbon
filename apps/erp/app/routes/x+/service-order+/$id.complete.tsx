// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { previewRefurbishmentCompletion } from "~/modules/service/service.server";
import { getDatabaseClient } from "~/services/database.server";

/**
 * The completion preview of a Refurbishment: the WIP, the unit cost before
 * and after, the sale price cap and the write-down. It runs the same reads
 * and planner as `complete-service-order` and writes nothing. Confirming
 * posts `status=Completed` to the status route, the one completion path.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  return previewRefurbishmentCompletion(getDatabaseClient(), {
    companyId,
    serviceOrderId: id
  });
}
