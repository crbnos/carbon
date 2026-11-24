// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { invoiceId, lineId } = params;
  if (!invoiceId || !lineId) {
    throw new Response("The invoice line could not be found.", {
      status: 404
    });
  }
  const { api } = await authorize(request);
  return api.invoicing.getPurchaseInvoiceLinePostedAccount({
    invoiceId,
    lineId
  });
}
