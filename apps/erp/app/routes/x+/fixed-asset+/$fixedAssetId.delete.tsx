import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteFixedAsset, getFixedAsset } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId);
  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  return { asset: asset.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(params, "Failed to get fixed asset id"))
    );
  }

  const { error: deleteError } = await deleteFixedAsset(client, fixedAssetId);
  if (deleteError) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(deleteError, "Failed to delete fixed asset"))
    );
  }

  throw redirect(
    path.to.fixedAssets,
    await flash(request, success("Successfully deleted fixed asset"))
  );
}

export default function DeleteFixedAssetRoute() {
  const { fixedAssetId } = useParams();
  const { asset } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!asset) return null;
  if (!fixedAssetId) throw new Error("fixedAssetId is not found");

  const onCancel = () => navigate(path.to.fixedAsset(fixedAssetId));

  return (
    <ConfirmDelete
      action={path.to.deleteFixedAsset(fixedAssetId)}
      name={asset.fixedAssetId}
      text={`Are you sure you want to delete ${asset.fixedAssetId}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
