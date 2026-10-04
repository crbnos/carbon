// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  getMaterialType,
  materialTypeValidator,
  upsertMaterialType
} from "~/modules/items";
import MaterialTypeForm from "~/modules/items/ui/MaterialTypes/MaterialTypeForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
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

  return {
    materialType: materialType?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "parts"
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
    companyId,
    ...validation.data
  });

  if (updateMaterialType.error) {
    return data(
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

export default function EditMaterialTypesRoute() {
  const { materialType } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: materialType?.id ?? undefined,
    name: materialType?.name ?? "",
    code: materialType?.code ?? "",
    materialSubstanceId: materialType?.materialSubstanceId ?? "",
    materialFormId: materialType?.materialFormId ?? ""
  };

  return (
    <MaterialTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
