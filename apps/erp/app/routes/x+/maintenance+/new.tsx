import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getFailureModesList,
  maintenanceDispatchValidator,
  upsertMaintenanceDispatch
} from "~/modules/resources";
import MaintenanceDispatchForm from "~/modules/resources/ui/Maintenance/MaintenanceDispatchForm";
import { getNextSequence } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Maintenance",
  to: path.to.maintenanceDispatches,
  module: "resources"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "resources"
  });

  const failureModes = await getFailureModesList(client, companyId);

  return {
    failureModes: failureModes.data ?? []
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

  const nextSequence = await getNextSequence(
    client,
    "maintenanceDispatch",
    companyId
  );
  if (nextSequence.error) {
    throw redirect(
      path.to.maintenanceDispatches,
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const content = validation.data.content
    ? JSON.parse(validation.data.content)
    : {};

  // Determine locationId - use provided value or get from work center
  let locationId = validation.data.locationId || undefined;
  if (!locationId && validation.data.workCenterId) {
    const workCenter = await client
      .from("workCenter")
      .select("locationId")
      .eq("id", validation.data.workCenterId)
      .single();
    if (!workCenter.error && workCenter.data?.locationId) {
      locationId = workCenter.data.locationId;
    }
  }

  const insertDispatch = await upsertMaintenanceDispatch(client, {
    maintenanceDispatchId: nextSequence.data,
    status: validation.data.status,
    priority: validation.data.priority,
    severity: validation.data.severity || "Support Required",
    source: validation.data.source || "Reactive",
    oeeImpact: validation.data.oeeImpact || "No Impact",
    workCenterId: validation.data.workCenterId || undefined,
    locationId,
    assignee: validation.data.assignee || undefined,
    suspectedFailureModeId: validation.data.suspectedFailureModeId || undefined,
    plannedStartTime: validation.data.plannedStartTime || undefined,
    plannedEndTime: validation.data.plannedEndTime || undefined,
    content,
    companyId,
    createdBy: userId
  });

  if (insertDispatch.error) {
    throw redirect(
      path.to.maintenanceDispatches,
      await flash(
        request,
        error(insertDispatch.error, "Failed to create maintenance dispatch")
      )
    );
  }

  const newId = insertDispatch.data?.id;
  if (!newId) {
    throw redirect(
      path.to.maintenanceDispatches,
      await flash(request, error(null, "Failed to get new dispatch ID"))
    );
  }

  throw redirect(
    path.to.maintenanceDispatch(newId),
    await flash(request, success("Created maintenance dispatch"))
  );
}

export default function NewMaintenanceDispatchRoute() {
  const { failureModes } = useLoaderData<typeof loader>();

  const initialValues = {
    status: "Open" as const,
    priority: "Medium" as const,
    source: "Reactive" as const,
    severity: "Support Required" as const,
    oeeImpact: "No Impact" as const
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
