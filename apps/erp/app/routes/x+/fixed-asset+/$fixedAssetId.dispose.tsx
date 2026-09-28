import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetDisposalValidator,
  getFixedAsset
} from "~/modules/accounting";
import { disposeFixedAsset } from "~/modules/accounting/accounting.server";
import { FixedAssetDisposalForm } from "~/modules/accounting/ui/FixedAssets";
import { getDatabaseClient } from "~/services/database.server";
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

  if (
    asset.data.status !== "Active" &&
    asset.data.status !== "Fully Depreciated"
  ) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(null, "Only Active or Fully Depreciated assets can be disposed")
      )
    );
  }

  const nbv =
    Number(asset.data.acquisitionCost) -
    Number(asset.data.accumulatedDepreciation);

  return { asset: asset.data, currentNBV: nbv };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(fixedAssetDisposalValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await disposeFixedAsset(client, getDatabaseClient(), {
    fixedAssetId,
    disposalDate: validation.data.disposalDate,
    companyId,
    companyGroupId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(result.error.cause, result.error.flash))
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset disposed successfully"))
  );
}

export default function DisposeFixedAssetRoute() {
  const { currentNBV } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <FixedAssetDisposalForm
      currentNBV={currentNBV}
      onClose={() => navigate(-1)}
    />
  );
}
