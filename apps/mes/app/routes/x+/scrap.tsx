// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { scrapOperationQuantity } from "~/services/complete.server";
import { erpPosting } from "~/services/erp";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await authorize(request, {});
  return scrapOperationQuantity(
    { client: getCarbonServiceRole(), post: erpPosting },
    { request, companyId, userId }
  );
}
