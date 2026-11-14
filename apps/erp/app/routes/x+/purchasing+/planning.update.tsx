// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  plannedOrderIdValidator,
  updatePlannedOrderValidator
} from "~/modules/production/production.models";
import {
  applyPlanningActions,
  orderPlannedPurchases,
  updatePlanningPurchaseOrderLine
} from "~/modules/purchasing/purchasing.server";

// The planning page posts JSON: an `action` and its payload.
const planningActionIds = z.array(z.string());
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("order"),
    locationId: z.string(),
    items: orderPlannedPurchases.input.shape.items
  }),
  z.object({
    action: z.literal("updateLine"),
    locationId: z.string(),
    line: updatePlanningPurchaseOrderLine.input.shape.line
  }),
  z.object({
    action: applyPlanningActions.input.shape.type,
    planningActionIds
  }),
  z.object({ action: z.enum(["dismiss", "reopen"]), planningActionIds }),
  z.object({
    action: z.literal("assign"),
    planningActionIds,
    assignee: z.string().nullish()
  }),
  plannedOrderIdValidator.extend({
    action: z.enum(["firmPlannedOrder", "unfirmPlannedOrder"])
  }),
  updatePlannedOrderValidator.extend({
    action: z.literal("updatePlannedOrder")
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(body).request(args);
  // The screens toast `message`; they show no field errors.
  if ("invalid" in input) {
    return data(
      { success: false, message: "The planning request is not valid" },
      { status: 400 }
    );
  }
  const request = input.data;
  const api = await carbon(args.request);
  const purchasing = api.purchasing;

  switch (request.action) {
    case "order":
      return respond(
        await purchasing.orderPlannedPurchases({
          locationId: request.locationId,
          items: request.items
        })
      );
    case "updateLine":
      return respond(
        await purchasing.updatePlanningPurchaseOrderLine({
          locationId: request.locationId,
          line: request.line
        })
      );
    case "dismiss":
      return respond(
        await purchasing.dismissPurchasingPlanningActions({
          planningActionIds: request.planningActionIds
        })
      );
    case "reopen":
      return respond(
        await purchasing.reopenPurchasingPlanningActions({
          planningActionIds: request.planningActionIds
        })
      );
    case "assign":
      return respond(
        await purchasing.assignPurchasingPlanningActions({
          planningActionIds: request.planningActionIds,
          assignee: request.assignee ?? undefined
        })
      );
    // Planned orders are production's operations; a Buy one needs
    // `update: purchasing`, which the operation checks.
    case "firmPlannedOrder":
      return respond(
        await api.production.firmPlannedOrder({
          id: request.id,
          locationId: request.locationId
        })
      );
    case "unfirmPlannedOrder":
      return respond(
        await api.production.unfirmPlannedOrder({
          id: request.id,
          locationId: request.locationId
        })
      );
    case "updatePlannedOrder":
      return respond(
        await api.production.updatePlannedOrder({
          id: request.id,
          locationId: request.locationId,
          quantity: request.quantity,
          dueDate: request.dueDate
        })
      );
    default:
      return respond(
        await purchasing.applyPlanningActions({
          planningActionIds: request.planningActionIds,
          type: request.action
        })
      );
  }
}

/**
 * The planning screens read `{ success, message }` (`usePlanningActions`,
 * shared with production planning, and the order drawer), so the result is
 * answered in that shape, an error with its status.
 */
function respond<T extends { message: string }>(result: {
  data: T | null;
  error: { message: string; status: number } | null;
}) {
  return result.error
    ? data(
        { success: false, message: result.error.message },
        { status: result.error.status }
      )
    : { success: true, ...(result.data as T) };
}
