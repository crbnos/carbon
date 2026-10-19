// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { maintenanceScheduleValidator } from "~/modules/resources/resources.models";
import { getMaintenanceSchedule } from "~/modules/resources/resources.service";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(maintenanceScheduleValidator).request(args, {
    params: ["scheduleId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.updateMaintenanceSchedule({
    ...input.data,
    id: input.params.scheduleId
  });
  // The drawer posts through a fetcher, which toasts a refusal.
  if (result.error) return result;
  return respond(args.request, result).redirect(path.to.maintenanceSchedules, {
    message: "Updated maintenance schedule"
  });
}

export default function EditMaintenanceScheduleRoute() {
  const { schedule } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: schedule.id ?? undefined,
    name: schedule.name ?? "",
    workCenterId: schedule.workCenterId ?? "",
    locationId: (schedule as any).locationId ?? "",
    frequency: schedule.frequency ?? ("Weekly" as const),
    priority: schedule.priority ?? ("Medium" as const),
    estimatedDuration: schedule.estimatedDuration ?? undefined,
    takesWorkCenterOffline: (schedule as any).takesWorkCenterOffline ?? false,
    nextDueAt: schedule.nextDueAt ? schedule.nextDueAt.slice(0, 10) : undefined,
    active: schedule.active ?? true,
    // Day-of-week settings
    monday: schedule.monday ?? true,
    tuesday: schedule.tuesday ?? true,
    wednesday: schedule.wednesday ?? true,
    thursday: schedule.thursday ?? true,
    friday: schedule.friday ?? true,
    saturday: schedule.saturday ?? true,
    sunday: schedule.sunday ?? true,
    skipHolidays: schedule.skipHolidays ?? true,
    procedureId: (schedule as any).procedureId ?? undefined
  };

  return (
    <MaintenanceScheduleForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
