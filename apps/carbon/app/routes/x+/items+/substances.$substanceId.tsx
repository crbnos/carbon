import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  MaterialSubstanceForm,
  getMaterialSubstance,
  materialSubstanceValidator,
  upsertMaterialSubstance,
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

  const { substanceId } = params;
  if (!substanceId) throw notFound("substanceId not found");

  const materialSubstance = await getMaterialSubstance(client, substanceId);

  return json({
    materialSubstance: materialSubstance?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { substanceId } = params;
  if (!substanceId) throw new Error("Could not find substanceId");

  const formData = await request.formData();
  const validation = await validator(materialSubstanceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialSubstance = await upsertMaterialSubstance(client, {
    id: substanceId,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateMaterialSubstance.error) {
    return json(
      {},
      await flash(
        request,
        error(
          updateMaterialSubstance.error,
          "Failed to update material substance"
        )
      )
    );
  }

  throw redirect(
    `${path.to.materialSubstances}?${getParams(request)}`,
    await flash(request, success("Updated material substance"))
  );
}

export default function EditMaterialSubstancesRoute() {
  const { materialSubstance } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialSubstance?.id ?? undefined,
    name: materialSubstance?.name ?? "",
    ...getCustomFields(materialSubstance?.customFields),
  };

  return (
    <MaterialSubstanceForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
