import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialDimension, getMaterialDimension } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialDimension = await getMaterialDimension(id);
  if (materialDimension.error) {
    throw redirect(
      path.to.materialDimensions,
      await flash(
        request,
        error(materialDimension.error, "Failed to get material dimension")
      )
    );
  }

  return { materialDimension: materialDimension.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.materialDimensions,
      await flash(
        request,
        error(params, "Failed to get an material dimension id")
      )
    );
  }

  const { error: deleteTypeError } = await deleteMaterialDimension(id);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.materialDimensions}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete material dimension")
      )
    );
  }

  throw redirect(
    path.to.materialDimensions,
    await flash(request, success("Successfully deleted material dimension"))
  );
}

export default function DeleteMaterialDimensionRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { materialDimension } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!materialDimension) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialDimension(id)}
      name={materialDimension.name}
      text={t`Are you sure you want to delete the material dimension: ${materialDimension.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
