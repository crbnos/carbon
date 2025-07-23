import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialType, getMaterialType } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialType = await getMaterialType(client, id);
  if (materialType.error) {
    throw redirect(
      path.to.materialTypes,
      await flash(
        request,
        error(materialType.error, "Failed to get material type")
      )
    );
  }

  return json({ materialType: materialType.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.materialTypes,
      await flash(request, error(params, "Failed to get a material type id"))
    );
  }

  const { error: deleteTypeError } = await deleteMaterialType(client, id);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.materialTypes}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete material type")
      )
    );
  }

  throw redirect(
    path.to.materialTypes,
    await flash(request, success("Successfully deleted material type"))
  );
}

export default function DeleteMaterialTypeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { materialType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!materialType) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialType(id)}
      name={materialType.name}
      text={`Are you sure you want to delete the material type: ${materialType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}