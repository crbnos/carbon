// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  getOperationCorrections,
  getUpstreamOperations
} from "~/services/operations.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const { operationId } = params;

  if (!operationId) throw new Error("operationId is required");

  const [result, corrections] = await Promise.all([
    getUpstreamOperations(client, operationId),
    getOperationCorrections(client, operationId, companyId)
  ]);
  return {
    operations: result.data ?? [],
    // The job's corrections for this operation's part, offered beside the
    // earlier operations.
    corrections: corrections.data ?? []
  };
}
