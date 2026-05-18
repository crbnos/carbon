import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { holidayValidator, upsertHoliday } from "~/modules/people";
import { HolidayForm } from "~/modules/people/ui/Holidays";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "people"
  });

  const formData = await request.formData();
  const validation = await validator(holidayValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createHoliday = await upsertHoliday({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createHoliday.error) {
    throw redirect(
      path.to.holidays,
      await flash(
        request,
        error(createHoliday.error, "Failed to create holiday.")
      )
    );
  }

  throw redirect(
    path.to.holidays,
    await flash(request, success("Holiday created"))
  );
}

export default function NewHolidayRoute() {
  const initialValues = {
    name: "",
    date: ""
  };

  return <HolidayForm initialValues={initialValues} />;
}
