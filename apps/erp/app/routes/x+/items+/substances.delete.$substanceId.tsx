import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialSubstance, getMaterialSubstance } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });
  const { substanceId } = params;
  if (!substanceId) throw notFound("substanceId not found");

  const materialSubstance = await getMaterialSubstance(substanceId);
  if (materialSubstance.error) {
    throw redirect(
      path.to.materialSubstances,
      await flash(
        request,
        error(materialSubstance.error, "Failed to get material substance")
      )
    );
  }

  return { materialSubstance: materialSubstance.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "parts"
  });

  const { substanceId } = params;
  if (!substanceId) {
    throw redirect(
      path.to.materialSubstances,
      await flash(
        request,
        error(params, "Failed to get an material substance id")
      )
    );
  }

  const { error: deleteTypeError } = await deleteMaterialSubstance(substanceId);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.materialSubstances}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete material substance")
      )
    );
  }

  throw redirect(
    path.to.materialSubstances,
    await flash(request, success("Successfully deleted material substance"))
  );
}

export default function DeleteMaterialSubstanceRoute() {
  const { substanceId } = useParams();
  if (!substanceId) throw new Error("substanceId not found");

  const { materialSubstance } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!materialSubstance) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialSubstance(substanceId)}
      name={materialSubstance.name}
      text={t`Are you sure you want to delete the material substance: ${materialSubstance.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
