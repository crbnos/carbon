import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { materialGradeValidator } from "~/modules/items";
import {
  getMaterialGrade,
  upsertMaterialGrade
} from "~/modules/items/items.service.server";
import MaterialGradeForm from "~/modules/items/ui/MaterialGrades/MaterialGradeForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialGrade = await getMaterialGrade(id);

  if (materialGrade.data?.companyId === null) {
    throw redirect(
      path.to.materialGrades,
      await flash(
        request,
        error(new Error("Access denied"), "Cannot edit global material grade")
      )
    );
  }

  return {
    materialGrade: materialGrade?.data ?? null
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
  const validation = await validator(materialGradeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialGrade = await upsertMaterialGrade({
    id: id,
    ...validation.data
  });

  if (updateMaterialGrade.error) {
    return data(
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
    materialSubstanceId: materialGrade?.materialSubstanceId ?? ""
  };

  return (
    <MaterialGradeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
