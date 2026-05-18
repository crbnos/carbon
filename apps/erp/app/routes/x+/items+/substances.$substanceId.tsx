import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getMaterialSubstance,
  materialSubstanceValidator,
  upsertMaterialSubstance
} from "~/modules/items";
import { MaterialSubstanceForm } from "~/modules/items/ui/MaterialSubstances";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { substanceId } = params;
  if (!substanceId) throw notFound("substanceId not found");

  const materialSubstance = await getMaterialSubstance(substanceId);

  if (materialSubstance.data?.companyId === null) {
    throw redirect(
      path.to.materialSubstances,
      await flash(
        request,
        error(
          new Error("Access denied"),
          "Cannot edit global material substance"
        )
      )
    );
  }

  return {
    materialSubstance: materialSubstance?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
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

  const updateMaterialSubstance = await upsertMaterialSubstance({
    id: substanceId,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateMaterialSubstance.error) {
    return data(
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
    code: materialSubstance?.code ?? "",
    ...getCustomFields(materialSubstance?.customFields)
  };

  return (
    <MaterialSubstanceForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
