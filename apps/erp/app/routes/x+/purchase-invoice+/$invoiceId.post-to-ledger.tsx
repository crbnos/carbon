// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { purchaseInvoicePostToLedgerValidator } from "~/modules/invoicing/invoicing.models";

/** The dialog loads its preview when it opens or a field changes. After a
 *  post the invoice has its payable, so a revalidation would only ask for a
 *  preview the service now refuses. */
export const shouldRevalidate = () => false;

/** The preview of the journal, for the date and offset account asked. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");
  const search = new URL(request.url).searchParams;
  const api = await carbon(request);
  return api.invoicing.previewPurchaseInvoiceLedgerPosting({
    invoiceId,
    postingDate: search.get("postingDate") ?? "",
    openingOffsetAccountId: search.get("openingOffsetAccountId") || undefined
  });
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseInvoicePostToLedgerValidator).request(
    args,
    { params: ["invoiceId"] }
  );
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  return api.invoicing.postPurchaseInvoiceToLedger({
    invoiceId: input.params.invoiceId,
    postingDate: input.data.postingDate,
    openingOffsetAccountId: input.data.openingOffsetAccountId
  });
}
