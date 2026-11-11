// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  type ForceDeleteDocumentType,
  forceDeleteDecisionValidator,
  forceDeleteDocumentTypes,
  forceDeleteRequestValidator
} from "~/modules/shared/shared.models";
import { path } from "~/utils/path";

/** The document's page, and the list it leaves for once deleted. */
const pages: Record<
  ForceDeleteDocumentType,
  { details: (id: string) => string; list: string }
> = {
  purchaseInvoice: {
    details: path.to.purchaseInvoiceDetails,
    list: path.to.invoicingPurchasing
  },
  salesInvoice: {
    details: path.to.salesInvoiceDetails,
    list: path.to.invoicingSales
  },
  receipt: { details: path.to.receiptDetails, list: path.to.receipts },
  payment: { details: path.to.payment, list: path.to.payments }
};

function isDocumentType(value: unknown): value is ForceDeleteDocumentType {
  return forceDeleteDocumentTypes.includes(value as ForceDeleteDocumentType);
}

/**
 * The Admin force-delete override of a purchase invoice, sales invoice,
 * receipt or payment: ask (`request`), then `approve`, `reject` or `cancel`.
 * The service functions check that the caller is an Admin.
 *
 * The document is redirected to at its details page, never its index: the
 * index redirects again, and that second hop reaches the page the form was
 * on as a same-path GET, which the root loader skips (`rootShouldRevalidate`),
 * so the flash would never toast.
 */
export async function action(args: ActionFunctionArgs) {
  const { documentType, documentId } = args.params;
  if (!isDocumentType(documentType) || !documentId) {
    throw notFound("Unknown document");
  }
  const page = pages[documentType];
  const intent = (await args.request.clone().formData()).get("intent");
  const api = await carbon(args.request);

  if (intent === "request") {
    const input = await validator(forceDeleteRequestValidator).request(args);
    if ("invalid" in input) return input.invalid;
    const result = await api.invoicing.requestDocumentForceDelete({
      documentType,
      documentId,
      reason: input.data.reason,
      confirmation: input.data.confirmation
    });
    return respond(args.request, result).redirect(page.details(documentId), {
      message: "Force delete requested. Another Admin must approve it."
    });
  }

  const input = await validator(forceDeleteDecisionValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { requestId, notes } = input.data;

  if (input.data.intent === "cancel") {
    const result = await api.invoicing.cancelDocumentForceDelete({
      documentType,
      requestId
    });
    return respond(args.request, result).redirect(page.details(documentId), {
      message: "Force delete request cancelled"
    });
  }

  const result = await api.invoicing.decideDocumentForceDelete({
    documentType,
    requestId,
    decision: input.data.intent,
    notes
  });
  const decided = result.data;
  if (decided?.status === "Executed") {
    return respond(args.request, result).redirect(page.list, {
      message: `${decided.documentReadableId} was force deleted`
    });
  }
  return respond(args.request, result).redirect(page.details(documentId), {
    message: "Force delete rejected"
  });
}
