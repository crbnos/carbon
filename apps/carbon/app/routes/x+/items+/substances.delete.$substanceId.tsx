import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialForm, getMaterialForm } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });
  const { formId } = params;
  if (!formId) throw notFound("formId not found");

  const materialForm = await getMaterialForm(client, formId);
  if (materialForm.error) {
    throw redirect(
      path.to.materialForms,
      await flash(
        request,
        error(materialForm.error, "Failed to get material form")
      )
    );
  }

  return json({ materialForm: materialForm.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { formId } = params;
  if (!formId) {
    throw redirect(
      path.to.materialForms,
      await flash(request, error(params, "Failed to get an material form id"))
    );
  }

  const { error: deleteTypeError } = await deleteMaterialForm(client, formId);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.materialForms}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete material form")
      )
    );
  }

  throw redirect(
    path.to.materialForms,
    await flash(request, success("Successfully deleted material form"))
  );
}

export default function DeleteMaterialFormRoute() {
  const { formId } = useParams();
  if (!formId) throw new Error("formId not found");

  const { materialForm } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!materialForm) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialForm(formId)}
      name={materialForm.name}
      text={`Are you sure you want to delete the material form: ${materialForm.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
