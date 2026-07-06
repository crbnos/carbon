import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  fixedAssetRegisterValidator,
  getFixedAsset
} from "~/modules/accounting";
import { FixedAssetRegisterForm } from "~/modules/accounting/ui/FixedAssets";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
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

  if (asset.data.status !== "Draft") {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(null, "Only Draft assets can be registered"))
    );
  }

  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(fixedAssetRegisterValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await client
    .from("fixedAsset")
    .update({
      ...validation.data,
      status: "Active",
      updatedBy: userId
    })
    .eq("id", fixedAssetId)
    .eq("status", "Draft");

  if (result.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(result.error, "Failed to register asset"))
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset registered successfully"))
  );
}

export default function RegisterFixedAssetRoute() {
  const navigate = useNavigate();

  return <FixedAssetRegisterForm onClose={() => navigate(-1)} />;
}
