import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { materialFormValidator } from "~/modules/items";
import {
  getMaterialForm,
  upsertMaterialForm
} from "~/modules/items/items.service.server";
import { MaterialShapeForm } from "~/modules/items/ui/MaterialShapes";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { formId } = params;
  if (!formId) throw notFound("formId not found");

  const materialForm = await getMaterialForm(formId);

  if (materialForm.data?.companyId === null) {
    throw redirect(
      path.to.materialForms,
      await flash(
        request,
        error(new Error("Access Denied"), "Cannot edit global material shape")
      )
    );
  }

  return {
    materialForm: materialForm?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { formId } = params;
  if (!formId) throw new Error("Could not find formId");

  const formData = await request.formData();
  const validation = await validator(materialFormValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialForm = await upsertMaterialForm({
    id: formId,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateMaterialForm.error) {
    return data(
      {},
      await flash(
        request,
        error(updateMaterialForm.error, "Failed to update material form")
      )
    );
  }

  throw redirect(
    `${path.to.materialForms}?${getParams(request)}`,
    await flash(request, success("Updated material form"))
  );
}

export default function EditMaterialFormsRoute() {
  const { materialForm } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialForm?.id ?? undefined,
    name: materialForm?.name ?? "",
    code: materialForm?.code ?? "",
    ...getCustomFields(materialForm?.customFields)
  };

  return (
    <MaterialShapeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
