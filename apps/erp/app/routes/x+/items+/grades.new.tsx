import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { materialGradeValidator } from "~/modules/items";
import { upsertMaterialGrade } from "~/modules/items/items.service.server";
import MaterialGradeForm from "~/modules/items/ui/MaterialGrades/MaterialGradeForm";

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

  const validation = await validator(materialGradeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertMaterialGrade = await upsertMaterialGrade({
    ...rest,
    companyId
  });
  if (insertMaterialGrade.error) {
    return data(
      {},
      await flash(
        request,
        error(insertMaterialGrade.error, "Failed to insert material grade")
      )
    );
  }

  const materialGradeId = insertMaterialGrade.data?.id;
  if (!materialGradeId) {
    return data(
      {},
      await flash(
        request,
        error(insertMaterialGrade, "Failed to insert material grade")
      )
    );
  }

  return modal
    ? data(insertMaterialGrade, { status: 201 })
    : redirect(
        `${path.to.materialGrades}?${getParams(request)}`,
        await flash(request, success("Grade created"))
      );
}

export default function NewMaterialGradesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    materialSubstanceId: ""
  };

  return (
    <MaterialGradeForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
