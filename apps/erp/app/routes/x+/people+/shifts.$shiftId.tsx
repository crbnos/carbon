import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getShift, shiftValidator, upsertShift } from "~/modules/people";
import { ShiftForm } from "~/modules/people/ui/Shifts";
import { notifyScheduleInputsChanged } from "~/modules/production";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "people"
  });

  const formData = await request.formData();
  const validation = await validator(shiftValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("Shift ID is required");

  const createShift = await upsertShift(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createShift.error) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(createShift.error, "Failed to create shift"))
    );
  }

  await notifyScheduleInputsChanged(companyId, "shift", "Shift hours changed");

  throw redirect(
    path.to.shifts,
    await flash(request, success("Shift updated"))
  );
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
