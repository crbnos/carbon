import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  ShiftForm,
  getShift,
  shiftValidator,
  upsertShift,
} from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
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

  return json({
    shift: shift.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "people",
  });

  const formData = await request.formData();
  const validation = await validator(shiftValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("Shift ID is required");

  const createShift = await upsertShift(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createShift.error) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(createShift.error, "Failed to create shift"))
    );
  }

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
    ...getCustomFields(shift.customFields),
  };

  return <ShiftForm key={initialValues.id} initialValues={initialValues} />;
}
