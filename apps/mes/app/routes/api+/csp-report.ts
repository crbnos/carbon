// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cspReportAction } from "@carbon/auth/middleware/security.server";
import type { ActionFunctionArgs } from "react-router";

// CSP_REPORT_PATH: where browsers send report-only CSP violations.
export async function action({ request }: ActionFunctionArgs) {
  return cspReportAction(request);
}
