// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { shiftValidator } from "~/modules/people/people.models";
import { getShift } from "~/modules/people/people.service";
import { ShiftForm } from "~/modules/people/ui/Shifts";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people"
  });

  const { shiftId } = params;
  if (!shiftId) throw notFound("Shift ID was not found");

  const shift = await getShift(client, shiftId);

  if (shift.error) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(shift.error, "Failed to get shift"))
    );
  }

  return {
    shift: shift.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(shiftValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id, ...shift } = input.data;
  if (!id) throw new Error("Shift ID is required");
  const api = await carbon(args.request);
  const result = await api.people.updateShift({
    ...shift,
    id,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(path.to.shifts, {
    message: "Shift updated"
  });
}

export default function ShiftRoute() {
  const { shift } = useLoaderData<typeof loader>();

  const initialValues = {
    id: shift.id ?? "",
    name: shift.name ?? "",
    startTime: shift.startTime ?? "",
    endTime: shift.endTime ?? "",
    locationId: shift.locationId ?? "",
    monday: shift.monday ?? false,
    tuesday: shift.tuesday ?? false,
    wednesday: shift.wednesday ?? false,
    thursday: shift.thursday ?? false,
    friday: shift.friday ?? false,
    saturday: shift.saturday ?? false,
    sunday: shift.sunday ?? false,
    ...getCustomFields(shift.customFields)
  };

  return <ShiftForm key={initialValues.id} initialValues={initialValues} />;
}
