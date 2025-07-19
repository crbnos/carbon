import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { materialGradeValidator, upsertMaterialGrade } from "~/modules/items";
import MaterialGradeForm from "~/modules/items/ui/MaterialGrades/MaterialGradeForm";

import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(materialGradeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertMaterialGrade = await upsertMaterialGrade(client, {
    ...data,
    companyId,
  });
  if (insertMaterialGrade.error) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialGrade.error, "Failed to insert material grade")
      )
    );
  }

  const materialGradeId = insertMaterialGrade.data?.id;
  if (!materialGradeId) {
    return json(
      {},
      await flash(
        request,
        error(insertMaterialGrade, "Failed to insert material grade")
      )
    );
  }

  return modal
    ? json(insertMaterialGrade, { status: 201 })
    : redirect(
        `${path.to.materialGrades}?${getParams(request)}`,
        await flash(request, success("Part group created"))
      );
}

export default function NewMaterialGradesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    materialSubstanceId: "",
  };

  return (
    <MaterialGradeForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
