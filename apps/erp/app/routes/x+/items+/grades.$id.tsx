import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getMaterialGrade,
  materialGradeValidator,
  upsertMaterialGrade,
} from "~/modules/items";
import MaterialGradeForm from "~/modules/items/ui/MaterialGrades/MaterialGradeForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialGrade = await getMaterialGrade(client, id);

  if (materialGrade.data?.companyId === null) {
    throw redirect(
      path.to.materialGrades,
      await flash(
        request,
        error(new Error("Access denied"), "Cannot edit global material grade")
      )
    );
  }

  return json({
    materialGrade: materialGrade?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "parts",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  console.log("id", id);

  const formData = await request.formData();
  const validation = await validator(materialGradeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialGrade = await upsertMaterialGrade(client, {
    id: id,
    ...validation.data,
  });

  if (updateMaterialGrade.error) {
    return json(
      {},
      await flash(
        request,
        error(updateMaterialGrade.error, "Failed to update material grade")
      )
    );
  }

  throw redirect(
    `${path.to.materialGrades}?${getParams(request)}`,
    await flash(request, success("Updated material grade"))
  );
}

export default function EditMaterialGradesRoute() {
  const { materialGrade } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialGrade?.id ?? undefined,
    name: materialGrade?.name ?? "",
    materialSubstanceId: materialGrade?.materialSubstanceId ?? "",
  };

  return (
    <MaterialGradeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
