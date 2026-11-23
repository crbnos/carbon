// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  serviceJobAssignmentMoveValidator,
  serviceJobAssignmentValidator
} from "~/modules/service/service.models";

// The dispatch grid: one operation per intent. A backlog job dropped on a cell
// is `assign` (and the block modal saves through it with the assignment's id),
// a block dropped on another cell is `move`, a block dropped on the backlog is
// `unassign`.
const scheduleForm = z.discriminatedUnion("intent", [
  serviceJobAssignmentValidator.extend({ intent: z.literal("assign") }),
  serviceJobAssignmentMoveValidator.extend({ intent: z.literal("move") }),
  z.object({ intent: z.literal("unassign"), id: z.string().min(1) })
]);

export async function action(args: ActionFunctionArgs) {
  await requirePermissions(args.request, { update: "service" });
  const input = await validator(scheduleForm).request(args);
  if ("invalid" in input) return input.invalid;
  const form = input.data;
  const service = (await carbon(args.request)).service;

  switch (form.intent) {
    case "assign":
      return service.upsertServiceJobAssignment(form);
    case "move":
      return service.moveServiceJobAssignment(form);
    case "unassign":
      return service.deleteServiceJobAssignment(form);
  }
}
