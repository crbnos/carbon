import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { materialFinishValidator } from "~/modules/items";
import {
  getMaterialFinish,
  upsertMaterialFinish
} from "~/modules/items/items.service.server";
import MaterialFinishForm from "~/modules/items/ui/MaterialFinishes/MaterialFinishForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialFinish = await getMaterialFinish(id);

  if (materialFinish.data?.companyId === null) {
    throw redirect(
      path.to.materialFinishes,
      await flash(
        request,
        error(new Error("Access denied"), "Cannot edit global material grade")
      )
    );
  }

  return {
    materialFinish: materialFinish?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(materialFinishValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialFinish = await upsertMaterialFinish({
    id: id,
    ...validation.data
  });

  if (updateMaterialFinish.error) {
    return data(
      {},
      await flash(
        request,
        error(updateMaterialFinish.error, "Failed to update material grade")
      )
    );
  }

  throw redirect(
    `${path.to.materialFinishes}?${getParams(request)}`,
    await flash(request, success("Updated material grade"))
  );
}

export default function EditMaterialFinishsRoute() {
  const { materialFinish } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialFinish?.id ?? undefined,
    name: materialFinish?.name ?? "",
    materialSubstanceId: materialFinish?.materialSubstanceId ?? ""
  };

  return (
    <MaterialFinishForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
