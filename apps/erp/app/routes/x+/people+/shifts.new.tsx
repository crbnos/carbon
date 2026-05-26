import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { shiftValidator } from "~/modules/people";
import { upsertShift } from "~/modules/people/people.service.server";
import { ShiftForm } from "~/modules/people/ui/Shifts";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "people"
  });

  const formData = await request.formData();
  const validation = await validator(shiftValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createShift = await upsertShift({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createShift.error) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(createShift.error, "Failed to create shift"))
    );
  }

  throw redirect(
    path.to.shifts,
    await flash(request, success("Shift created"))
  );
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
