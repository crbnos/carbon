import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  getWorkCenter,
  upsertWorkCenter,
  WorkCenterForm,
  workCenterValidator
} from "~/modules/resources";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, workCentersQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid work center id");

  const workCenter = await getWorkCenter(client, id);
  if (workCenter.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(workCenter.error, "Failed to fetch work center")
      )
    );
  }

  return { workCenter: workCenter.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(workCenterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("ID is was not found");

  const updateWorkCenter = await upsertWorkCenter(client, {
    id,
    ...d,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateWorkCenter.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(updateWorkCenter.error, "Failed to update work center")
      )
    );
  }

  throw redirect(
    path.to.workCenters,
    await flash(request, success("Updated work center "))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    workCentersQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function WorkCenterRoute() {
  const { workCenter } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCenters);

  const initialValues = {
    id: workCenter?.id ?? undefined,
    defaultStandardFactor: workCenter?.defaultStandardFactor ?? "Minutes/Piece",
    departmentId: workCenter?.departmentId ?? undefined,
    description: workCenter?.description ?? "",
    laborRate: workCenter?.laborRate ?? 0,
    locationId: workCenter?.locationId ?? "",
    machineRate: workCenter?.machineRate ?? 0,
    name: workCenter?.name ?? "",
    overheadRate: workCenter?.overheadRate ?? 0,
    processes: workCenter?.processes ?? [],
    requiredAbilityId: workCenter?.requiredAbilityId ?? undefined,
    ...getCustomFields(workCenter?.customFields)
  };

  return (
    <WorkCenterForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
    />
  );
}
