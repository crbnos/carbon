import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getMaterialFinish,
  materialFinishValidator,
  upsertMaterialFinish,
} from "~/modules/items";
import MaterialFinishForm from "~/modules/items/ui/MaterialFinishes/MaterialFinishForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialFinish = await getMaterialFinish(client, id);

  if (materialFinish.data?.companyId === null) {
    throw redirect(
      path.to.materialFinishes,
      await flash(
        request,
        error(new Error("Access denied"), "Cannot edit global material grade")
      )
    );
  }

  return json({
    materialFinish: materialFinish?.data ?? null,
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
  const validation = await validator(materialFinishValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialFinish = await upsertMaterialFinish(client, {
    id: id,
    ...validation.data,
  });

  if (updateMaterialFinish.error) {
    return json(
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
    materialSubstanceId: materialFinish?.materialSubstanceId ?? "",
  };

  return (
    <MaterialFinishForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
