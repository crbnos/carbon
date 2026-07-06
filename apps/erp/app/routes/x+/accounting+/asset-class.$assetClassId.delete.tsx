import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteFixedAssetClass,
  getFixedAssetClass
} from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { assetClassId } = params;
  if (!assetClassId) throw notFound("assetClassId not found");

  const assetClass = await getFixedAssetClass(client, assetClassId);
  if (assetClass.error) {
    throw redirect(
      path.to.assetClasses,
      await flash(request, error(assetClass.error, "Failed to get asset class"))
    );
  }

  return { assetClass: assetClass.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { assetClassId } = params;
  if (!assetClassId) {
    throw redirect(
      path.to.assetClasses,
      await flash(request, error(params, "Failed to get asset class id"))
    );
  }

  const { error: deleteError } = await deleteFixedAssetClass(
    client,
    assetClassId
  );
  if (deleteError) {
    throw redirect(
      path.to.assetClasses,
      await flash(request, error(deleteError, "Failed to delete asset class"))
    );
  }

  throw redirect(
    path.to.assetClasses,
    await flash(request, success("Successfully deleted asset class"))
  );
}

export default function DeleteAssetClassRoute() {
  const { assetClassId } = useParams();
  const { assetClass } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!assetClass) return null;
  if (!assetClassId) throw new Error("assetClassId is not found");

  const onCancel = () => navigate(path.to.assetClasses);

  return (
    <ConfirmDelete
      action={path.to.deleteAssetClass(assetClassId)}
      name={assetClass.name}
      text={`Are you sure you want to delete the asset class: ${assetClass.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
