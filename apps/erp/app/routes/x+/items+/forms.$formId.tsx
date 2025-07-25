import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getMaterialForm,
  materialFormValidator,
  upsertMaterialForm,
} from "~/modules/items";
import { MaterialShapeForm } from "~/modules/items/ui/MaterialForms";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { formId } = params;
  if (!formId) throw notFound("formId not found");

  const materialForm = await getMaterialForm(client, formId);

  if (materialForm.data?.companyId === null) {
    throw redirect(
      path.to.materialForms,
      await flash(
        request,
        error(new Error("Access Denied"), "Cannot edit global material shape")
      )
    );
  }

  return json({
    materialForm: materialForm?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { formId } = params;
  if (!formId) throw new Error("Could not find formId");

  const formData = await request.formData();
  const validation = await validator(materialFormValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialForm = await upsertMaterialForm(client, {
    id: formId,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateMaterialForm.error) {
    return json(
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
    ...getCustomFields(materialForm?.customFields),
  };

  return (
    <MaterialShapeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
