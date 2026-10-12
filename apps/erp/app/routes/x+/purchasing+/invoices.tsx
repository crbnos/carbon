// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["purchaseInvoice"]
};

// Purchase invoices now live solely in the invoicing module. This legacy
// Purchasing-module URL redirects there, preserving any filter query string
// (e.g. ?filter=supplierId:eq:...).
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`${path.to.invoicingPurchasing}${url.search}`);
}
