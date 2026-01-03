import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getMaintenanceSchedule,
  maintenanceScheduleValidator,
  upsertMaintenanceSchedule
} from "~/modules/resources";
import MaintenanceScheduleForm from "~/modules/resources/ui/MaintenanceSchedule/MaintenanceScheduleForm";
import { path } from "~/utils/path";

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
      path.to.maintenanceSchedules,
      await flash(
        request,
        error(schedule.error, "Failed to get maintenance schedule")
      )
    );
  }

  return {
    schedule: schedule.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(maintenanceScheduleValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateSchedule = await upsertMaintenanceSchedule(client, {
    id,
    ...d,
    updatedBy: userId
  });

  if (updateSchedule.error) {
    return data(
      {},
      await flash(
        request,
        error(updateSchedule.error, "Failed to update maintenance schedule")
      )
    );
  }

  throw redirect(
    path.to.maintenanceSchedules,
    await flash(request, success("Updated maintenance schedule"))
  );
}

export default function EditMaintenanceScheduleRoute() {
  const { schedule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: schedule.id ?? undefined,
    name: schedule.name ?? "",
    workCenterId: schedule.workCenterId ?? "",
    frequency: schedule.frequency ?? ("Weekly" as const),
    priority: schedule.priority ?? ("Medium" as const),
    estimatedDuration: schedule.estimatedDuration ?? undefined,
    active: schedule.active ?? true,
    // Day-of-week settings
    monday: schedule.monday ?? true,
    tuesday: schedule.tuesday ?? true,
    wednesday: schedule.wednesday ?? true,
    thursday: schedule.thursday ?? true,
    friday: schedule.friday ?? true,
    saturday: schedule.saturday ?? true,
    sunday: schedule.sunday ?? true,
    skipHolidays: schedule.skipHolidays ?? true
  };

  return (
    <MaintenanceScheduleForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
