// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

/**
 * Drafts the invoice of a Completed service order from its Unbilled items
 * (`create-service-order-invoice`), which also closes the order, then opens
 * the Draft invoice.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.service.createServiceOrderInvoice({
    serviceOrderId: id
  });
  if (!result.data) {
    return respond(args.request, result).redirect(
      path.to.serviceOrderBilling(id)
    );
  }
  return respond(args.request, result).redirect(
    path.to.salesInvoiceDetails(result.data.salesInvoiceId),
    { message: `Invoice ${result.data.invoiceId} drafted` }
  );
}
