// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  materialDimensionValidator,
  upsertMaterialDimension
} from "~/modules/items";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";
import { getCompanySettings } from "~/modules/settings";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
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

  const settings = await getCompanySettings(client, companyId);

  const insertMaterialDimension = await upsertMaterialDimension(client, {
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
  const closeRoute = useCloseRoute();
  const initialValues = {
    name: "",
    materialFormId: ""
  };

  return (
    <MaterialDimensionForm
      onClose={() => closeRoute()}
      initialValues={initialValues}
    />
  );
}
