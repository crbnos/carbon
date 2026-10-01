// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getUpstreamOperations } from "~/services/operations.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});
  const { operationId } = params;

  if (!operationId) throw new Error("operationId is required");

  const result = await getUpstreamOperations(client, operationId);
  return { operations: result.data ?? [] };
}
