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
import { postAssetRegistration } from "~/modules/accounting/accounting.server";
import { FixedAssetRegisterForm } from "~/modules/accounting/ui/FixedAssets";
import { getCompanySettings } from "~/modules/settings";
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

  const registration = validation.data;

  const companySettings = await getCompanySettings(client, companyId);
  if (companySettings.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(companySettings.error, "Failed to load company settings")
      )
    );
  }
  const accountingEnabled =
    (companySettings.data as { accountingEnabled?: boolean } | null)
      ?.accountingEnabled ?? false;

  // With accounting on, capitalize the asset with a real GL entry
  // (Dr asset / Cr owner equity) rather than a bare status flip, so no
  // capitalized asset exists without a journal.
  if (accountingEnabled) {
    const [asset, defaults, dimensionsResult, accountingPeriod] =
      await Promise.all([
        client
          .from("fixedAsset")
          .select(
            "fixedAssetId, locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId, accumulatedDepreciationAccountId)"
          )
          .eq("id", fixedAssetId)
          .eq("companyId", companyId)
          .single(),
        getDefaultAccounts(client, companyId),
        client
          .from("dimension")
          .select("id, entityType")
          .eq("companyGroupId", companyGroupId)
          .eq("active", true),
        getOrCreateAccountingPeriod(
          client,
          companyId,
          registration.acquisitionDate,
          "accounting"
        )
      ]);

    if (asset.error || !asset.data) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(request, error(asset.error, "Failed to get fixed asset"))
      );
    }
    if (accountingPeriod.error || !accountingPeriod.data) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(
          request,
          error(accountingPeriod.error, "Failed to get accounting period")
        )
      );
    }
    if (dimensionsResult.error) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(
          request,
          error(dimensionsResult.error, "Failed to resolve dimensions")
        )
      );
    }

    const assetClass = asset.data.fixedAssetClass as {
      assetAccountId: string;
      accumulatedDepreciationAccountId: string;
    } | null;
    const assetAccountId = assetClass?.assetAccountId;
    const accumulatedDepreciationAccountId =
      assetClass?.accumulatedDepreciationAccountId;
    const offsetAccountId = defaults.data?.retainedEarningsAccount;

    if (
      !assetAccountId ||
      !accumulatedDepreciationAccountId ||
      !offsetAccountId
    ) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(
          request,
          error(
            defaults.error,
            "Missing GL accounts for asset registration. Configure the asset class and default accounts."
          )
        )
      );
    }

    const locationDimensionId = (dimensionsResult.data ?? []).find(
      (d) => d.entityType === "Location"
    )?.id;
    const assetClassDimensionId = (dimensionsResult.data ?? []).find(
      (d) => d.entityType === "FixedAssetClass"
    )?.id;

    if (!locationDimensionId || !assetClassDimensionId) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(
          request,
          error(null, "Missing dimensions required for asset registration")
        )
      );
    }

    try {
      await postAssetRegistration(getDatabaseClient(), {
        fixedAssetId,
        fixedAssetReadableId: asset.data.fixedAssetId,
        registration,
        locationId: asset.data.locationId,
        fixedAssetClassId: asset.data.fixedAssetClassId,
        assetAccountId,
        accumulatedDepreciationAccountId,
        offsetAccountId,
        accountingPeriodId: accountingPeriod.data,
        locationDimensionId,
        assetClassDimensionId,
        companyId,
        userId
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

  // Accounting disabled — a plain status flip (no journal). Select the affected
  // row back so a concurrent update that already moved the asset out of Draft
  // (zero rows matched) is treated as a failure rather than a false success.
  const result = await client
    .from("fixedAsset")
    .update({
      ...registration,
      status: "Active",
      updatedBy: userId
    })
    .eq("id", fixedAssetId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id");

  if (result.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(result.error, "Failed to register asset"))
    );
  }

  if (!result.data || result.data.length === 0) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(null, "Only Draft assets can be registered"))
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
