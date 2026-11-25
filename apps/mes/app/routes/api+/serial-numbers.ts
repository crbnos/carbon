// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getIssueLotsForItem } from "~/services/inventory.service";

/**
 * The lots the issue dialog offers. The location is the operation's job's,
 * read on the server, never one the browser names.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await authorize(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const jobOperationId = url.searchParams.get("operationId");
  if (!itemId || !jobOperationId) return { data: [], error: null };

  return getIssueLotsForItem(client, {
    itemId,
    companyId,
    jobOperationId,
    checkPairing: true
  });
}
