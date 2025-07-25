import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getMaterialDimension,
  materialDimensionValidator,
  upsertMaterialDimension,
} from "~/modules/items";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";

import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialDimension = await getMaterialDimension(client, id);

  if (materialDimension.data?.companyId === null) {
    throw redirect(
      path.to.materialDimensions,
      await flash(
        request,
        error(new Error("Access denied"), "Cannot edit global material grade")
      )
    );
  }

  return json({
    materialDimension: materialDimension?.data ?? null,
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
  const validation = await validator(materialDimensionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialDimension = await upsertMaterialDimension(client, {
    id: id,
    ...validation.data,
  });

  if (updateMaterialDimension.error) {
    return json(
      {},
      await flash(
        request,
        error(updateMaterialDimension.error, "Failed to update material grade")
      )
    );
  }

  throw redirect(
    `${path.to.materialDimensions}?${getParams(request)}`,
    await flash(request, success("Updated material grade"))
  );
}

export default function EditMaterialDimensionsRoute() {
  const { materialDimension } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialDimension?.id ?? undefined,
    name: materialDimension?.name ?? "",
    materialFormId: materialDimension?.materialFormId ?? "",
  };

  return (
    <MaterialDimensionForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
