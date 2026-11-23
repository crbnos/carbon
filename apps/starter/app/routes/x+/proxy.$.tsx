// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { proxyToErp } from "@carbon/auth/erp-proxy.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// The ERP's API routes, reached from the starter: `path.to.erpApi`.
export async function loader({ request, params }: LoaderFunctionArgs) {
  return proxyToErp(request, params["*"]);
}

export async function action({ request, params }: ActionFunctionArgs) {
  return proxyToErp(request, params["*"]);
}
