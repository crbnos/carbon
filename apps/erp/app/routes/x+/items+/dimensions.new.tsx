import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  materialDimensionValidator,
  upsertMaterialDimension,
} from "~/modules/items";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";

import { getParams, path } from "~/utils/path";

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

  const validation = await validator(materialDimensionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertMaterialDimension = await upsertMaterialDimension(client, {
    ...data,
    companyId,
  });
  if (insertMaterialDimension.error) {
    return json(
      {},
      await flash(
        request,
        error(
          insertMaterialDimension.error,
          "Failed to insert material dimension"
        )
      )
    );
  }

  const materialDimensionId = insertMaterialDimension.data?.id;
  if (!materialDimensionId) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialDimension, "Failed to insert material dimension")
      )
    );
  }

  return modal
    ? json(insertMaterialDimension, { status: 201 })
    : redirect(
        `${path.to.materialDimensions}?${getParams(request)}`,
        await flash(request, success("Dimension created"))
      );
}

export default function NewMaterialDimensionsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    materialFormId: "",
  };

  return (
    <MaterialDimensionForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
