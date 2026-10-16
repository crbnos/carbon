// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { maintenanceDispatchValidator } from "~/modules/resources/resources.models";
import { getFailureModesList } from "~/modules/resources/resources.service";
import MaintenanceDispatchForm from "~/modules/resources/ui/Maintenance/MaintenanceDispatchForm";
import { getUserDefaults } from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Maintenance`,
  to: path.to.maintenanceDispatches,
  module: "resources"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const [failureModes, defaults] = await Promise.all([
    getFailureModesList(client, companyId),
    getUserDefaults(client, userId, companyId)
  ]);

  return {
    failureModes: failureModes.data ?? [],
    defaultLocationId: defaults.data?.locationId ?? undefined
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(maintenanceDispatchValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.createMaintenanceDispatch(input.data);
  return respond(args.request, result).redirect(
    result.data
      ? path.to.maintenanceDispatch(result.data.id)
      : path.to.maintenanceDispatches,
    { message: "Created maintenance dispatch" }
  );
}

export default function NewMaintenanceDispatchRoute() {
  const { failureModes, defaultLocationId } = useLoaderData<typeof loader>();

  const initialValues = {
    status: "Open" as const,
    priority: "Medium" as const,
    source: "Reactive" as const,
    severity: "Support Required" as const,
    oeeImpact: "No Impact" as const,
    takesWorkCenterOffline: false,
    locationId: defaultLocationId ?? ""
  };

  return (
    <NewRecordPage>
      <MaintenanceDispatchForm
        initialValues={initialValues}
        failureModes={failureModes}
      />
    </NewRecordPage>
  );
}
