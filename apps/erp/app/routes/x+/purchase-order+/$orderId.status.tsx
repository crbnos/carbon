// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { path, requestReferrer } from "~/utils/path";

// Reopen to Draft (the order page) or Planned (the planning pages), optionally
// as the next revision, or close. Every other status is reached through
// finalize, approval, receipts and invoices.
const form = z.object({
  status: z.enum(["Draft", "Planned", "Closed"]),
  createRevision: z.string().optional()
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, { params: ["orderId"] });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const { status, createRevision } = input.data;
  const to = requestReferrer(args.request) ?? path.to.purchaseOrder(orderId);
  const api = await carbon(args.request);

  if (status === "Closed") {
    const result = await api.purchasing.closePurchaseOrderAndApprovals({
      purchaseOrderId: orderId
    });
    return respond(args.request, result).redirect(to, {
      message: "Updated purchasing order status"
    });
  }

  const result = await api.purchasing.reopenPurchaseOrder({
    purchaseOrderId: orderId,
    status,
    createRevision: createRevision === "true"
  });
  return respond(args.request, result).redirect(to, {
    message: result.data?.revision
      ? "Created a new purchase order revision"
      : "Updated purchasing order status"
  });
}
