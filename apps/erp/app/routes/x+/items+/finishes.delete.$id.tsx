import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialGrade, getMaterialGrade } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialGrade = await getMaterialGrade(client, id);
  if (materialGrade.error) {
    throw redirect(
      path.to.materialGrades,
      await flash(
        request,
        error(materialGrade.error, "Failed to get material grade")
      )
    );
  }

  return json({ materialGrade: materialGrade.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.materialGrades,
      await flash(request, error(params, "Failed to get an material grade id"))
    );
  }

  const { error: deleteTypeError } = await deleteMaterialGrade(client, id);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.materialGrades}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete material grade")
      )
    );
  }

  throw redirect(
    path.to.materialGrades,
    await flash(request, success("Successfully deleted material grade"))
  );
}

export default function DeleteMaterialGradeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { materialGrade } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!materialGrade) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialGrade(id)}
      name={materialGrade.name}
      text={`Are you sure you want to delete the material grade: ${materialGrade.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
