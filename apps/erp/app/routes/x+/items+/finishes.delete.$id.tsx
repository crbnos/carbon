import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialFinish, getMaterialFinish } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialFinish = await getMaterialFinish(client, id);
  if (materialFinish.error) {
    throw redirect(
      path.to.materialFinishes,
      await flash(
        request,
        error(materialFinish.error, "Failed to get material finish")
      )
    );
  }

  return json({ materialFinish: materialFinish.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.materialFinishes,
      await flash(request, error(params, "Failed to get an material finish id"))
    );
  }

  const { error: deleteTypeError } = await deleteMaterialFinish(client, id);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.materialFinishes}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete material finish")
      )
    );
  }

  throw redirect(
    path.to.materialFinishes,
    await flash(request, success("Successfully deleted material finish"))
  );
}

export default function DeleteMaterialFinishRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { materialFinish } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!materialFinish) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialFinish(id)}
      name={materialFinish.name}
      text={`Are you sure you want to delete the material finish: ${materialFinish.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
