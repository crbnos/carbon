import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { materialTypeValidator, upsertMaterialType } from "~/modules/items";
import MaterialTypeForm from "~/modules/items/ui/MaterialTypes/MaterialTypeForm";

import { getParams, path } from "~/utils/path";
import { getCompanyId, materialTypesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(materialTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertMaterialType = await upsertMaterialType(client, {
    ...data,
    companyId,
  });
  if (insertMaterialType.error) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialType.error, "Failed to insert material type")
      )
    );
  }

  const materialTypeId = insertMaterialType.data?.id;
  if (!materialTypeId) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialType, "Failed to insert material type")
      )
    );
  }

  return modal
    ? json(insertMaterialType, { status: 201 })
    : redirect(
        `${path.to.materialTypes}?${getParams(request)}`,
        await flash(request, success("Type created"))
      );
}

export async function clientAction({
  request,
  serverAction,
}: ClientActionFunctionArgs) {
  const formData = await request.clone().formData();
  const validation = await validator(materialTypeValidator).validate(formData);

  if (!validation.error) {
    const companyId = getCompanyId();
    const { materialSubstanceId, materialFormId } = validation.data;

    if (companyId && materialSubstanceId && materialFormId) {
      // Invalidate the cache for this specific combination
      window.clientCache?.setQueryData(
        materialTypesQuery(materialSubstanceId, materialFormId, companyId)
          .queryKey,
        null
      );
    }
  }

  return await serverAction();
}

export default function NewMaterialTypesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    code: "",
    materialSubstanceId: "",
    materialFormId: "",
  };

  return (
    <MaterialTypeForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
