import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  MaterialSubstanceForm,
  materialSubstanceValidator,
  upsertMaterialSubstance,
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
    description: "",
  };

  return (
    <MaterialSubstanceForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
