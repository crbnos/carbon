import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  MaterialFormForm,
  getMaterialForm,
  materialFormValidator,
  upsertMaterialForm,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { formId } = params;
  if (!formId) throw notFound("formId not found");

  const materialForm = await getMaterialForm(client, formId);

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
    ...getCustomFields(materialForm?.customFields),
  };

  return (
    <MaterialFormForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
