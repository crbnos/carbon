import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  MaterialShapeForm,
  materialFormValidator,
  upsertMaterialForm,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(materialFormValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertMaterialForm = await upsertMaterialForm(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertMaterialForm.error) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialForm.error, "Failed to insert material form")
      )
    );
  }

  const materialFormId = insertMaterialForm.data?.id;
  if (!materialFormId) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialForm, "Failed to insert material form")
      )
    );
  }

  return modal
    ? json(insertMaterialForm, { status: 201 })
    : redirect(
        `${path.to.materialForms}?${getParams(request)}`,
        await flash(request, success("Material form created"))
      );
}

export default function NewMaterialFormsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    description: "",
  };

  return (
    <MaterialShapeForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
