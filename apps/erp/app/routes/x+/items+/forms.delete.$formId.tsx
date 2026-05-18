import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialForm, getMaterialForm } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });
  const { formId } = params;
  if (!formId) throw notFound("formId not found");

  const materialForm = await getMaterialForm(formId);
  if (materialForm.error) {
    throw redirect(
      path.to.materialForms,
      await flash(
        request,
        error(materialForm.error, "Failed to get material form")
      )
    );
  }

  return { materialForm: materialForm.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "parts"
  });

  const { formId } = params;
  if (!formId) {
    throw redirect(
      path.to.materialForms,
      await flash(request, error(params, "Failed to get an material form id"))
    );
  }

  const { error: deleteTypeError } = await deleteMaterialForm(formId);
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
  const { t } = useLingui();

  if (!materialForm) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialForm(formId)}
      name={materialForm.name}
      text={t`Are you sure you want to delete the material form: ${materialForm.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
