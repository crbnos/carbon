import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  materialSubstanceValidator,
  upsertMaterialSubstance,
} from "~/modules/items";
import { MaterialSubstanceForm } from "~/modules/items/ui/MaterialSubstances";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

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

  const validation = await validator(materialSubstanceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertMaterialSubstance = await upsertMaterialSubstance(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertMaterialSubstance.error) {
    return json(
      {},
      await flash(
        request,
        error(
          insertMaterialSubstance.error,
          "Failed to insert material substance"
        )
      )
    );
  }

  const materialSubstanceId = insertMaterialSubstance.data?.id;
  if (!materialSubstanceId) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialSubstance, "Failed to insert material substance")
      )
    );
  }

  return modal
    ? json(insertMaterialSubstance, { status: 201 })
    : redirect(
        `${path.to.materialSubstances}?${getParams(request)}`,
        await flash(request, success("Part group created"))
      );
}

export default function NewMaterialSubstancesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    code: "",
    description: "",
  };

  return (
    <MaterialSubstanceForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
