// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

// Production planning: the grid's Make button and bulk actions, the order
// drawer and the worklist lines post JSON here. One operation per `action`;
// each validates the rest of its body.
const locationId = z.string();
const planningActionIds = z.array(z.string());
const planningForm = z.discriminatedUnion("action", [
  z.object({ action: z.literal("order"), locationId, items: z.any() }),
  z.object({ action: z.literal("updateJob"), locationId, job: z.any() }),
  z.object({
    action: z.literal("planJob"),
    locationId,
    job: z.object({ id: z.string() })
  }),
  z.object({
    action: z.enum([
      "apply",
      "expedite",
      "defer",
      "increase",
      "decrease",
      "cancel"
    ]),
    locationId,
    planningActionIds
  }),
  z.object({
    action: z.enum(["dismiss", "reopen"]),
    locationId,
    planningActionIds
  }),
  z.object({
    action: z.literal("assign"),
    locationId,
    planningActionIds,
    assignee: z.string().nullish()
  })
]);

// A type-specific apply keeps only the actions of that type.
const APPLY_TYPE = {
  apply: undefined,
  expedite: "Expedite",
  defer: "Defer",
  increase: "Increase",
  decrease: "Decrease",
  cancel: "Cancel"
} as const;

export async function action(args: ActionFunctionArgs) {
  const input = await validator(planningForm).request(args);
  // The screens toast `message`; they show no field errors.
  if ("invalid" in input) {
    return data(
      { success: false, message: "The planning request is not valid" },
      { status: 400 }
    );
  }
  const form = input.data;
  const planning = (await carbon(args.request)).production;

  switch (form.action) {
    case "order":
      return planning.orderPlannedJobs({
        locationId: form.locationId,
        items: form.items
      });
    case "updateJob":
      return planning.updatePlannedJob({
        locationId: form.locationId,
        job: form.job
      });
    case "planJob":
      return planning.planJobFromPlanning({
        locationId: form.locationId,
        jobId: form.job.id
      });
    case "dismiss":
      return planning.dismissProductionPlanningActions(form);
    case "reopen":
      return planning.reopenProductionPlanningActions(form);
    case "assign":
      return planning.assignProductionPlanningActions({
        planningActionIds: form.planningActionIds,
        assignee: form.assignee ?? undefined
      });
    default:
      return planning.applyPlanningActions({
        planningActionIds: form.planningActionIds,
        type: APPLY_TYPE[form.action]
      });
  }
}
