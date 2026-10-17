// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { receiptSourceDocumentType } from "~/modules/inventory/inventory.models";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Receipts`,
  to: path.to.receipts
};

const source = z.object({
  sourceDocument: zfd.text(z.enum(receiptSourceDocumentType).optional()),
  sourceDocumentId: zfd.text(z.string().optional())
});

/** A failed create goes back to the document it started from. */
function sourcePath({
  sourceDocument,
  sourceDocumentId = ""
}: z.output<typeof source>) {
  switch (sourceDocument) {
    case "Purchase Order":
      return path.to.purchaseOrder(sourceDocumentId);
    case "Sales Return Order":
      return path.to.salesReturnOrderDetails(sourceDocumentId);
    case "Inbound Transfer":
      return path.to.warehouseTransfer(sourceDocumentId);
    case "Rental Agreement":
      return path.to.rentalAgreementDetails(sourceDocumentId);
    default:
      return path.to.receipts;
  }
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(source).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.createReceipt(input.data);
  if (!result.data) {
    return respond(args.request, result).redirect(sourcePath(input.data), {
      message: ""
    });
  }
  throw redirect(path.to.receiptDetails(result.data.id));
}
