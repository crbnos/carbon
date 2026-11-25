// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { completeOperationQuantity } from "~/services/complete.server";
import { getDatabaseClient } from "~/services/database.server";
import { erpPosting } from "~/services/erp";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, permissions } = await authorize(request);
  return completeOperationQuantity(
    {
      client,
      serviceRole: getCarbonServiceRole(),
      db: getDatabaseClient,
      post: erpPosting
    },
    { request, companyId, userId, permissions }
  );
}
