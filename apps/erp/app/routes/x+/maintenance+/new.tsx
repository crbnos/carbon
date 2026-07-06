import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getFailureModesList,
  insertMaintenanceDispatch,
  maintenanceDispatchValidator
} from "~/modules/resources";
import MaintenanceDispatchForm from "~/modules/resources/ui/Maintenance/MaintenanceDispatchForm";
import { getUserDefaults } from "~/modules/users/users.server";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(maintenanceDispatchValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const content = validation.data.content
    ? JSON.parse(validation.data.content)
    : undefined;

  const result = await insertMaintenanceDispatch(client, {
    status: validation.data.status,
    priority: validation.data.priority,
    severity: validation.data.severity || undefined,
    source: validation.data.source || undefined,
    oeeImpact: validation.data.oeeImpact || undefined,
    workCenterId: validation.data.workCenterId || undefined,
    locationId: validation.data.locationId,
    assignee: validation.data.assignee || undefined,
    suspectedFailureModeId: validation.data.suspectedFailureModeId || undefined,
    plannedStartTime: validation.data.plannedStartTime || undefined,
    plannedEndTime: validation.data.plannedEndTime || undefined,
    content,
    companyId,
    createdBy: userId
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.maintenanceDispatches,
      await flash(
        request,
        error(result.error, "Failed to create maintenance dispatch")
      )
    );
  }

  throw redirect(
    path.to.maintenanceDispatch(result.data.id),
    await flash(request, success("Created maintenance dispatch"))
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
    locationId: defaultLocationId ?? ""
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <MaintenanceDispatchForm
        initialValues={initialValues}
        failureModes={failureModes}
      />
    </div>
  );
}
