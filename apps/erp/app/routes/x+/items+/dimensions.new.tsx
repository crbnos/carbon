import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { materialDimensionValidator } from "~/modules/items";
import { upsertMaterialDimension } from "~/modules/items/items.service.server";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";
import { getCompanySettings } from "~/modules/settings/settings.service.server";

import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(materialDimensionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const settings = await getCompanySettings();

  const insertMaterialDimension = await upsertMaterialDimension({
    ...rest,
    companyId,
    isMetric: settings?.data?.useMetric ?? false
  });

  if (insertMaterialDimension.error) {
    return data(
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
    return data(
      {},
      await flash(
        request,
        error(insertMaterialDimension, "Failed to insert material dimension")
      )
    );
  }

  return modal
    ? data(insertMaterialDimension, { status: 201 })
    : redirect(
        `${path.to.materialDimensions}?${getParams(request)}`,
        await flash(request, success("Dimension created"))
      );
}

export default function NewMaterialDimensionsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    materialFormId: ""
  };

  return (
    <MaterialDimensionForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
