import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  WorkCellTypeForm,
  getWorkCellType,
  upsertWorkCellType,
  workCellTypeValidator,
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

  const { typeId } = params;
  if (!typeId) throw notFound("Invalid work cell type id");

  const workCellType = await getWorkCellType(client, typeId);
  if (workCellType.error) {
    throw redirect(
      path.to.workCells,
      await flash(
        request,
        error(workCellType.error, "Failed to fetch work cell type")
      )
    );
  }

  return json({ workCellType: workCellType.data });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "resources",
  });

  const formData = await request.formData();
  const validation = await validator(workCellTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("ID is was not found");

  const updateCategory = await upsertWorkCellType(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateCategory.error) {
    throw redirect(
      path.to.workCells,
      await flash(
        request,
        error(updateCategory.error, "Failed to update work cell type")
      )
    );
  }

  throw redirect(
    path.to.workCells,
    await flash(request, success("Updated work cell type "))
  );
}

export default function EditAttributeCategoryRoute() {
  const { workCellType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCells);

  const initialValues = {
    id: workCellType?.id,
    name: workCellType?.name ?? "",
    description: workCellType?.description ?? "",
    requiredAbility: workCellType?.requiredAbility ?? undefined,
    quotingRate: workCellType?.quotingRate ?? 0,
    laborRate: workCellType?.laborRate ?? 0,
    overheadRate: workCellType?.overheadRate ?? 0,
    defaultStandardFactor:
      workCellType?.defaultStandardFactor ?? "Minutes/Piece",
    ...getCustomFields(workCellType?.customFields),
  };

  return (
    <WorkCellTypeForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
    />
  );
}
