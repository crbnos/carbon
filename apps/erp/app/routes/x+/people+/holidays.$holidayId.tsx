import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getHoliday, holidayValidator, upsertHoliday } from "~/modules/people";
import { HolidayForm } from "~/modules/people/ui/Holidays";
import { getCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people"
  });

  const { holidayId } = params;
  if (!holidayId) throw notFound("Holiday ID was not found");

  const holiday = await getHoliday(holidayId);

  if (holiday.error) {
    throw redirect(
      path.to.holidays,
      await flash(request, error(holiday.error, "Failed to get holiday"))
    );
  }

  return {
    holiday: holiday.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    create: "people"
  });

  const formData = await request.formData();
  const validation = await validator(holidayValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, name, date } = validation.data;
  if (!id) throw notFound("Holiday ID was not found");

  const updateHoliday = await upsertHoliday({
    id,
    name,
    date,
    updatedBy: userId
  });

  if (updateHoliday.error) {
    throw redirect(
      path.to.holidays,
      await flash(
        request,
        error(updateHoliday.error, "Failed to create holiday.")
      )
    );
  }

  throw redirect(
    path.to.holidays,
    await flash(request, success("Holiday updated"))
  );
}

export default function HolidayRoute() {
  const { holiday } = useLoaderData<typeof loader>();

  const initialValues = {
    id: holiday.id,
    name: holiday.name,
    date: holiday.date,
    ...getCustomFields(holiday.customFields)
  };

  return <HolidayForm key={initialValues.id} initialValues={initialValues} />;
}
