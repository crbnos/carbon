import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteMaintenanceSchedule,
  getMaintenanceSchedule
} from "~/modules/resources";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });
  const { scheduleId } = params;
  if (!scheduleId) throw notFound("scheduleId not found");

  const schedule = await getMaintenanceSchedule(client, scheduleId);
  if (schedule.error) {
    throw redirect(
      `${path.to.maintenanceSchedules}?${getParams(request)}`,
      await flash(
        request,
        error(schedule.error, "Failed to get maintenance schedule")
      )
    );
  }

  return { schedule: schedule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources"
  });

  const { scheduleId } = params;
  if (!scheduleId) {
    throw redirect(
      `${path.to.maintenanceSchedules}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a schedule id"))
    );
  }

  const { error: deleteError } = await deleteMaintenanceSchedule(
    client,
    scheduleId
  );
  if (deleteError) {
    const errorMessage =
      deleteError.code === "23503"
        ? "Schedule has related dispatches, cannot delete"
        : "Failed to delete maintenance schedule";

    throw redirect(
      `${path.to.maintenanceSchedules}?${getParams(request)}`,
      await flash(request, error(deleteError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.maintenanceSchedules}?${getParams(request)}`,
    await flash(request, success("Successfully deleted maintenance schedule"))
  );
}

export default function DeleteMaintenanceScheduleRoute() {
  const { scheduleId } = useParams();
  const { schedule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!schedule) return null;
  if (!scheduleId) throw notFound("scheduleId not found");

  const onCancel = () => navigate(path.to.maintenanceSchedules);
  return (
    <ConfirmDelete
      action={path.to.deleteMaintenanceSchedule(scheduleId)}
      name={schedule.name}
      text={`Are you sure you want to delete the maintenance schedule: ${schedule.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
