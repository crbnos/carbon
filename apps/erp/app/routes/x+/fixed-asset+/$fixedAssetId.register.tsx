import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  fixedAssetRegisterValidator,
  getDefaultAccounts,
  getFixedAsset,
  getOrCreateAccountingPeriod
} from "~/modules/accounting";
import { postAssetAcquisition } from "~/modules/accounting/accounting.server";
import { FixedAssetRegisterForm } from "~/modules/accounting/ui/FixedAssets";
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
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
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

  const {
    acquisitionCost,
    acquisitionDate,
    accumulatedDepreciation,
    depreciationStartDate
  } = validation.data;

  const [asset, accountingSettings] = await Promise.all([
    client
      .from("fixedAsset")
      .select("*, fixedAssetClass:fixedAssetClassId(assetAccountId)")
      .eq("id", fixedAssetId)
      .single(),
    client
      .from("companySettings")
      .select("accountingEnabled")
      .eq("id", companyId)
      .single()
  ]);

  if (asset.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  // Only post the acquisition journal when accounting is enabled and the account
  // defaults + period resolve; otherwise the register is a plain state flip.
  let accounting:
    | Parameters<typeof postAssetAcquisition>[1]["accounting"]
    | undefined;
  if (accountingSettings.data?.accountingEnabled) {
    const [accountDefaults, accountingPeriod, dimensionsResult] =
      await Promise.all([
        getDefaultAccounts(client, companyId),
        getOrCreateAccountingPeriod(
          client,
          companyId,
          acquisitionDate,
          "accounting"
        ),
        client
          .from("dimension")
          .select("id, entityType")
          .eq("companyGroupId", companyGroupId)
          .eq("active", true)
      ]);

    if (accountDefaults.error || accountingPeriod.error) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(
          request,
          error(
            accountDefaults.error ?? accountingPeriod.error,
            "Failed to resolve accounting configuration"
          )
        )
      );
    }

    const assetClass = asset.data.fixedAssetClass as unknown as {
      assetAccountId: string;
    };

    accounting = {
      accountingPeriodId: accountingPeriod.data!,
      assetAccountId: assetClass.assetAccountId,
      // GR/IR clearing — the same acquisition source the receipt path credits.
      acquisitionSourceAccountId:
        accountDefaults.data.goodsReceivedNotInvoicedAccount,
      locationDimensionId: (dimensionsResult.data ?? []).find(
        (d) => d.entityType === "Location"
      )?.id,
      assetClassDimensionId: (dimensionsResult.data ?? []).find(
        (d) => d.entityType === "FixedAssetClass"
      )?.id
    };
  }

  try {
    await postAssetAcquisition(getDatabaseClient(), {
      fixedAssetId,
      fixedAssetReadableId: asset.data.fixedAssetId,
      acquisitionCost,
      acquisitionDate,
      accumulatedDepreciation,
      depreciationStartDate,
      locationId: asset.data.locationId,
      fixedAssetClassId: asset.data.fixedAssetClassId,
      companyId,
      userId,
      accounting
    });
  } catch (err) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(err, "Failed to register asset"))
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
