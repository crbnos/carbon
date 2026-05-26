import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteHoliday,
  getHoliday
} from "~/modules/people/people.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
    role: "employee"
  });

  const { holidayId } = params;
  if (!holidayId) throw notFound("holidayId not found");

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

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "people"
  });

  const { holidayId } = params;
  if (!holidayId) {
    throw redirect(
      path.to.holidays,
      await flash(request, error(params, "Failed to get holiday id"))
    );
  }

  const { error: deleteHolidayError } = await deleteHoliday(holidayId);
  if (deleteHolidayError) {
    throw redirect(
      path.to.holidays,
      await flash(
        request,
        error(deleteHolidayError, "Failed to delete holiday")
      )
    );
  }

  throw redirect(
    path.to.holidays,
    await flash(request, success("Successfully deleted holiday"))
  );
}

export default function DeleteHolidayRoute() {
  const { holidayId } = useParams();
  const { holiday } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!holiday) return null;
  if (!holidayId) throw new Error("holidayId is not found");

  const onCancel = () => navigate(path.to.holidays);
  const name = holiday.name;
  return (
    <ConfirmDelete
      action={path.to.deleteHoliday(holidayId)}
      name={name}
      text={t`Are you sure you want to delete the holiday: ${name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
