// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ActionFunctionArgs } from "react-router";
import { handleCustomerPortalSubmission } from "./lib/customer-submission.server";

export async function action({ params, request }: ActionFunctionArgs) {
  return handleCustomerPortalSubmission(request, params.id, "po");
}
