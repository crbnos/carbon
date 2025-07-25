import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getMaterialType,
  materialTypeValidator,
  upsertMaterialType,
} from "~/modules/items";
import MaterialTypeForm from "~/modules/items/ui/MaterialTypes/MaterialTypeForm";
import { getParams, path } from "~/utils/path";

import { getCompanyId, materialTypesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialType = await getMaterialType(client, id);

  if (materialType.data?.companyId === null) {
    throw redirect(
      path.to.materialTypes,
      await flash(
        request,
        error(new Error("Access denied"), "Cannot edit global material type")
      )
    );
  }

  return json({
    materialType: materialType?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "parts",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(materialTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialType = await upsertMaterialType(client, {
    id: id,
    ...validation.data,
  });

  if (updateMaterialType.error) {
    return json(
      {},
      await flash(
        request,
        error(updateMaterialType.error, "Failed to update material type")
      )
    );
  }

  throw redirect(
    `${path.to.materialTypes}?${getParams(request)}`,
    await flash(request, success("Updated material type"))
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

export default function EditMaterialTypesRoute() {
  const { materialType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialType?.id ?? undefined,
    name: materialType?.name ?? "",
    code: materialType?.code ?? "",
    materialSubstanceId: materialType?.materialSubstanceId ?? "",
    materialFormId: materialType?.materialFormId ?? "",
  };

  return (
    <MaterialTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
