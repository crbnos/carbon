// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { shiftValidator } from "~/modules/people/people.models";
import { ShiftForm } from "~/modules/people/ui/Shifts";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(shiftValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...shift } = input.data;
  const api = await carbon(args.request);
  const result = await api.people.createShift({
    ...shift,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(path.to.shifts, {
    message: "Shift created"
  });
}

export default function NewShiftRoute() {
  const initialValues = {
    name: "",
    locationId: "",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
    startTime: "08:00",
    endTime: "17:00"
  };

  return <ShiftForm initialValues={initialValues} />;
}
