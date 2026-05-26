import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { materialFinishValidator } from "~/modules/items";
import { upsertMaterialFinish } from "~/modules/items/items.service.server";
import MaterialFinishForm from "~/modules/items/ui/MaterialFinishes/MaterialFinishForm";

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

  const validation = await validator(materialFinishValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertMaterialFinish = await upsertMaterialFinish({
    ...rest,
    companyId
  });
  if (insertMaterialFinish.error) {
    return data(
      {},
      await flash(
        request,
        error(insertMaterialFinish.error, "Failed to insert material finish")
      )
    );
  }

  const materialFinishId = insertMaterialFinish.data?.id;
  if (!materialFinishId) {
    return data(
      {},
      await flash(
        request,
        error(insertMaterialFinish, "Failed to insert material finish")
      )
    );
  }

  return modal
    ? data(insertMaterialFinish, { status: 201 })
    : redirect(
        `${path.to.materialFinishes}?${getParams(request)}`,
        await flash(request, success("Finish created"))
      );
}

export default function NewMaterialFinishsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    materialSubstanceId: ""
  };

  return (
    <MaterialFinishForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
