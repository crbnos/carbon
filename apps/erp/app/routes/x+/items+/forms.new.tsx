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
import { materialFormValidator, upsertMaterialForm } from "~/modules/items";
import { MaterialShapeForm } from "~/modules/items/ui/MaterialShapes";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(materialFormValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertMaterialForm = await upsertMaterialForm(client, {
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertMaterialForm.error) {
    return data(
      {},
      await flash(
        request,
        error(insertMaterialForm.error, "Failed to insert material form")
      )
    );
  }

  const materialFormId = insertMaterialForm.data?.id;
  if (!materialFormId) {
    return data(
      {},
      await flash(
        request,
        error(insertMaterialForm, "Failed to insert material form")
      )
    );
  }

  return modal
    ? data(insertMaterialForm, { status: 201 })
    : redirect(
        `${path.to.materialForms}?${getParams(request)}`,
        await flash(request, success("Material form created"))
      );
}

export default function NewMaterialFormsRoute() {
  const closeRoute = useCloseRoute();
  const initialValues = {
    name: "",
    code: "",
    description: ""
  };

  return (
    <MaterialShapeForm
      onClose={() => closeRoute()}
      initialValues={initialValues}
    />
  );
}
