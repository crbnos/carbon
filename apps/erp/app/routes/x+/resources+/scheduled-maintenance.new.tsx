// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { maintenanceScheduleValidator } from "~/modules/resources/resources.models";
import MaintenanceScheduleForm from "~/modules/resources/ui/MaintenanceSchedule/MaintenanceScheduleForm";
import { getUserDefaults } from "~/modules/users/users.service";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const defaults = await getUserDefaults(client, userId, companyId);

  return {
    defaultLocationId: defaults.data?.locationId ?? undefined
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(maintenanceScheduleValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.createMaintenanceSchedule(input.data);
  // The modal form reads the result and closes itself.
  if (input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(
    `${path.to.maintenanceSchedules}?${getParams(args.request)}`,
    {
      message: "Maintenance schedule created",
      onError:
        requestReferrer(args.request) ??
        `${path.to.maintenanceSchedules}?${getParams(args.request)}`
    }
  );
}

export default function NewMaintenanceScheduleRoute() {
  const { defaultLocationId } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const initialValues = {
    name: "",
    workCenterId: "",
    locationId: defaultLocationId ?? "",
    frequency: "Weekly" as const,
    priority: "Medium" as const,
    estimatedDuration: undefined,
    takesWorkCenterOffline: false,
    nextDueAt: undefined,
    active: true,
    // Day-of-week defaults (all days enabled by default)
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
    skipHolidays: true,
    procedureId: undefined
  };

  return (
    <MaintenanceScheduleForm
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
