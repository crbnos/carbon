import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialDimension, getMaterialDimension } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialDimension = await getMaterialDimension(client, id);
  if (materialDimension.error) {
    throw redirect(
      path.to.materialDimensions,
      await flash(
        request,
        error(materialDimension.error, "Failed to get material dimension")
      )
    );
  }

  return json({ materialDimension: materialDimension.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
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

  const { error: deleteTypeError } = await deleteMaterialDimension(client, id);
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

  if (!materialDimension) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialDimension(id)}
      name={materialDimension.name}
      text={`Are you sure you want to delete the material dimension: ${materialDimension.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
