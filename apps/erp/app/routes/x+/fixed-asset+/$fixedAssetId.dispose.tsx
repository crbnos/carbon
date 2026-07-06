import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetDisposalValidator,
  getFixedAsset,
  getOrCreateAccountingPeriod
} from "~/modules/accounting";
import { postDisposal } from "~/modules/accounting/accounting.server";
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

  const { disposalDate } = validation.data;
  const disposalMethod = "Scrapping";

  const [asset, dimensionsResult] = await Promise.all([
    client
      .from("fixedAsset")
      .select("*, fixedAssetClass:fixedAssetClassId(*)")
      .eq("id", fixedAssetId)
      .single(),
    client
      .from("dimension")
      .select("id, entityType")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true)
  ]);

  if (asset.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(asset.error, "Failed to get asset"))
    );
  }

  const assetClass = asset.data.fixedAssetClass as any;
  const acquisitionCost = Number(asset.data.acquisitionCost);
  const accumulatedDepreciation = Number(asset.data.accumulatedDepreciation);

  const accountingPeriod = await getOrCreateAccountingPeriod(
    client,
    companyId,
    disposalDate
  );
  if (accountingPeriod.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(accountingPeriod.error, "Failed to get accounting period")
      )
    );
  }

  const locationDimensionId = (dimensionsResult.data ?? []).find(
    (d) => d.entityType === "Location"
  )?.id;

  const assetClassDimensionId = (dimensionsResult.data ?? []).find(
    (d) => d.entityType === "FixedAssetClass"
  )?.id;

  try {
    await postDisposal(getDatabaseClient(), {
      fixedAssetId,
      fixedAssetReadableId: asset.data.fixedAssetId,
      disposalDate,
      disposalMethod,
      acquisitionCost,
      accumulatedDepreciation,
      locationId: asset.data.locationId,
      fixedAssetClassId: asset.data.fixedAssetClassId,
      assetAccountId: assetClass.assetAccountId,
      accumulatedDepreciationAccountId:
        assetClass.accumulatedDepreciationAccountId,
      writeOffAccountId: assetClass.writeOffAccountId,
      accountingPeriodId: accountingPeriod.data!,
      locationDimensionId,
      assetClassDimensionId,
      companyId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(err, "Failed to post asset disposal"))
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
