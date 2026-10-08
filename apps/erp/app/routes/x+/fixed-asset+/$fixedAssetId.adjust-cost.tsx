// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetAdjustCostValidator,
  getDefaultAccounts,
  getFixedAsset,
  invokeAssetTransfer
} from "~/modules/accounting";
import { FixedAssetAdjustCostForm } from "~/modules/accounting/ui/FixedAssets";
import { getCompanySettings } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const [asset, companySettings, accountDefaults, timeZone] = await Promise.all(
    [
      getFixedAsset(client, fixedAssetId, companyId),
      getCompanySettings(client, companyId),
      getDefaultAccounts(client, companyId),
      getCompanyTimeZone(client, companyId)
    ]
  );
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
        error(
          null,
          "Only an Active or Fully Depreciated asset's cost can be adjusted"
        )
      )
    );
  }

  const accountingEnabled =
    (companySettings.data as { accountingEnabled?: boolean } | null)
      ?.accountingEnabled ?? false;
  const acquisitionCost = Number(asset.data.acquisitionCost);

  return {
    acquisitionCost,
    netBookValue: acquisitionCost - Number(asset.data.accumulatedDepreciation),
    hasLocation: Boolean(asset.data.locationId),
    accountingEnabled,
    initialValues: {
      amount: 0,
      // Retained Earnings unless the accountant picks the account the cost
      // was spent from this year.
      offsetAccountId: accountDefaults.data?.retainedEarningsAccount ?? "",
      locationId: asset.data.locationId ?? "",
      transferDate: datetime.today(timeZone).toString()
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // Recosting an asset puts a number of the user's own on the books.
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(fixedAssetAdjustCostValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { offsetAccountId, ...adjustment } = validation.data;

  const result = await invokeAssetTransfer(client, getDatabaseClient(), {
    type: "adjustCost",
    companyId,
    userId,
    fixedAssetId,
    ...adjustment,
    offsetAccountId: offsetAccountId || null
  });

  if (result.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to adjust the asset's cost")
        )
      )
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset cost adjusted"))
  );
}

export default function AdjustFixedAssetCostRoute() {
  const {
    acquisitionCost,
    netBookValue,
    hasLocation,
    accountingEnabled,
    initialValues
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <FixedAssetAdjustCostForm
      initialValues={initialValues}
      acquisitionCost={acquisitionCost}
      netBookValue={netBookValue}
      hasLocation={hasLocation}
      accountingEnabled={accountingEnabled}
      onClose={() => navigate(-1)}
    />
  );
}
