import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  WorkCenterForm,
  getWorkCenter,
  upsertWorkCenter,
  workCenterValidator,
} from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
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

  return json({ workCenter: workCenter.data });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources",
  });

  const formData = await request.formData();
  const validation = await validator(workCenterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("ID is was not found");

  const updateCategory = await upsertWorkCenter(client, {
    id,
    ...data,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateCategory.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(updateCategory.error, "Failed to update work center")
      )
    );
  }

  throw redirect(
    path.to.workCenters,
    await flash(request, success("Updated work center "))
  );
}

export default function WorkCenterRoute() {
  const { workCenter } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCenters);

  const initialValues = {
    id: workCenter?.id ?? undefined,
    name: workCenter?.name ?? "",
    description: workCenter?.description ?? "",
    requiredAbilityId: workCenter?.requiredAbilityId ?? undefined,
    quotingRate: workCenter?.quotingRate ?? 0,
    laborRate: workCenter?.laborRate ?? 0,
    overheadRate: workCenter?.overheadRate ?? 0,
    defaultStandardFactor: workCenter?.defaultStandardFactor ?? "Minutes/Piece",
    locationId: workCenter?.locationId ?? "",
    // @ts-ignore
    processes: (workCenter?.processes ?? []).map((p) => p.id) ?? [],
    ...getCustomFields(workCenter?.customFields),
  };

  return (
    <WorkCenterForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
    />
  );
}
