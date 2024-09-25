import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteHoliday, getHoliday } from "~/modules/people";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const { holidayId } = params;
  if (!holidayId) throw notFound("holidayId not found");

  const holiday = await getHoliday(client, holidayId);
  if (holiday.error) {
    throw redirect(
      path.to.holidays,
      await flash(request, error(holiday.error, "Failed to get holiday"))
    );
  }

  return json({
    holiday: holiday.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "people",
  });

  const { holidayId } = params;
  if (!holidayId) {
    throw redirect(
      path.to.holidays,
      await flash(request, error(params, "Failed to get holiday id"))
    );
  }

  const { error: deleteHolidayError } = await deleteHoliday(client, holidayId);
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

  if (!holiday) return null;
  if (!holidayId) throw new Error("holidayId is not found");

  const onCancel = () => navigate(path.to.holidays);

  return (
    <ConfirmDelete
      action={path.to.deleteHoliday(holidayId)}
      name={holiday.name}
      text={`Are you sure you want to delete the holiday: ${holiday.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
