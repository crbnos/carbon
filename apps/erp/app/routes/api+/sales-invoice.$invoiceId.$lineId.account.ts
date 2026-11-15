// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import type { LoaderFunctionArgs } from "react-router";

/** The account a posted line's revenue is on now, for the Change GL Account
 *  dialog. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { invoiceId, lineId } = params;
  if (!invoiceId || !lineId) {
    throw new Response("The invoice line could not be found.", {
      status: 404
    });
  }
  const api = await carbon(request);
  return api.invoicing.getSalesInvoiceLinePostedAccount({ invoiceId, lineId });
}
