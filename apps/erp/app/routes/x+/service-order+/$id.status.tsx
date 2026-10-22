// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import type { ServiceOrderStatusAction } from "~/modules/service/service.models";
import { serviceOrderStatusActions } from "~/modules/service/service.models";
import { path, requestReferrer } from "~/utils/path";

const MESSAGES: Record<ServiceOrderStatusAction, string> = {
  Planned: "Planned the service order",
  "On Hold": "Put the service order on hold",
  Completed: "Completed the service order",
  Closed: "Closed the service order",
  Cancelled: "Cancelled the service order"
};

/** The message of a move to Planned names what it did from `from`. */
function plannedMessage(from: string) {
  if (from === "On Hold") return "Resumed the service order";
  if (from === "Completed") return "Reopened the service order";
  return MESSAGES.Planned;
}

/**
 * Moves an order to the status the user chose (`setServiceOrderStatus`): a
 * completion runs `complete-service-order`, a cancel refuses an order with a
 * charge that is not reversed, and any other move rolls the order up from its
 * visits. Then goes back where the user was.
 */
export async function action(args: ActionFunctionArgs) {
  const back =
    requestReferrer(args.request) ??
    path.to.serviceOrderDetails(args.params.id ?? "");
  const input = await validator(
    z.object({
      status: z.enum(serviceOrderStatusActions, { error: "Invalid status" })
    })
  ).request(args, { params: ["id"] });
  if ("invalid" in input) {
    return respond(args.request, {
      error: { message: "Invalid status" }
    }).redirect(back);
  }
  const api = await carbon(args.request);
  const result = await api.service.setServiceOrderStatus({
    serviceOrderId: input.params.id,
    status: input.data.status
  });
  if (!result.data) return respond(args.request, result).redirect(back);

  const { from, status, warnings } = result.data;
  const message =
    status === "Completed"
      ? [MESSAGES.Completed, ...warnings]
          .map((line) => line.replace(/\.$/, ""))
          .join(". ")
      : status === "Planned"
        ? plannedMessage(from)
        : MESSAGES[status];
  return respond(args.request, result).redirect(back, { message });
}
