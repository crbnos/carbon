// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { carbon } from "~/modules/carbon.server";
import {
  copyPeopleBoardValidator,
  copyPeopleWeekValidator,
  peopleAbsenceRangeValidator,
  peopleAbsenceValidator,
  peopleAssignmentValidator,
  peopleDayValidator,
  peopleHoursValidator,
  peopleMoveValidator,
  peopleOvertimeBulkValidator,
  peopleWeekAssignValidator,
  peopleWeekMoveValidator,
  peopleWeekUnassignValidator
} from "~/modules/production";

const id = z.string().min(1);

// The people board, week board, header and dialogs: one operation per intent.
// The refined validators keep their own checks inside the union.
const peopleForm = z.discriminatedUnion("intent", [
  peopleAssignmentValidator.extend({ intent: z.literal("assign") }),
  z.object({ intent: z.literal("unassign"), id }),
  peopleAbsenceValidator.extend({ intent: z.literal("absent") }),
  z.object({
    intent: z.literal("clear-absence"),
    id,
    date: zfd.text(z.string().optional())
  }),
  peopleMoveValidator.extend({ intent: z.literal("move") }),
  peopleDayValidator.extend({ intent: z.literal("day-hours") }),
  peopleHoursValidator.extend({ intent: z.literal("hours") }),
  peopleOvertimeBulkValidator.safeExtend({
    intent: z.literal("overtime-bulk")
  }),
  copyPeopleBoardValidator.extend({ intent: z.literal("copy") }),
  peopleWeekAssignValidator.extend({ intent: z.literal("assign-week") }),
  peopleWeekUnassignValidator.extend({ intent: z.literal("unassign-week") }),
  peopleWeekMoveValidator.extend({ intent: z.literal("move-week") }),
  copyPeopleWeekValidator.extend({ intent: z.literal("copy-week") }),
  peopleAbsenceRangeValidator.safeExtend({
    intent: z.literal("absent-range")
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(peopleForm).request(args);
  if ("invalid" in input) return input.invalid;
  const form = input.data;
  const people = (await carbon(args.request)).production.people;

  switch (form.intent) {
    case "assign":
      return people.assign(form);
    case "unassign":
      return people.unassign(form);
    case "absent":
      return people.markAbsent(form);
    case "clear-absence":
      return people.clearAbsence({
        id: form.id,
        date:
          form.date ??
          new URL(args.request.url).searchParams.get("date") ??
          undefined
      });
    case "move":
      return people.move(form);
    case "day-hours":
      return people.setDay(form);
    case "hours":
      return people.setHours(form);
    case "overtime-bulk":
      return people.setOvertime(form);
    case "copy":
      return people.copyDay(form);
    case "assign-week":
      return people.assignWeek(form);
    case "unassign-week":
      return people.unassignWeek(form);
    case "move-week":
      return people.moveWeek(form);
    case "copy-week":
      return people.copyWeek(form);
    case "absent-range":
      return people.markAbsentRange(form);
  }
}
