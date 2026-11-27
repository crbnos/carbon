// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "resources.schedules": "View" });
  const { scheduleId } = params;
  if (!scheduleId) throw notFound("scheduleId not found");

  const schedule = await api.resources.getMaintenanceSchedule({ scheduleId });
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["scheduleId"] });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.resources.deleteMaintenanceSchedule({
    scheduleId: input.params.scheduleId
  });
  const list = `${path.to.maintenanceSchedules}?${getParams(args.request)}`;
  return respond(args.request, result).redirect(list, {
    message: "Successfully deleted maintenance schedule",
    onError: list
  });
}

export default function DeleteMaintenanceScheduleRoute() {
  const { scheduleId } = useParams();
  const { schedule } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.maintenanceSchedules);
  const { t } = useLingui();

  if (!schedule) return null;
  if (!scheduleId) throw notFound("scheduleId not found");

  const name = schedule.name;
  return (
    <ConfirmDelete
      action={path.to.deleteMaintenanceSchedule(scheduleId)}
      name={name}
      text={t`Are you sure you want to delete the maintenance schedule: ${name}? This cannot be undone.`}
      isOpen={dialog.open}
      onCancel={dialog.close}
    />
  );
}
