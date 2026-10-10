// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  fixedAssetRegisterValidator,
  getDefaultAccounts,
  getFixedAsset,
  getOrCreateAccountingPeriod
} from "~/modules/accounting";
import { postAssetRegistration } from "~/modules/accounting/accounting.server";
import { FixedAssetRegisterForm } from "~/modules/accounting/ui/FixedAssets";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "fixed-asset/register");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId, companyId);
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

  const [asset, defaults, dimensionsResult] = await Promise.all([
    client
      .from("fixedAsset")
      .select(
        "fixedAssetId, locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId, accumulatedDepreciationAccountId, isConstructionInProgress)"
      )
      .eq("id", fixedAssetId)
      .eq("companyId", companyId)
      .single(),
    getDefaultAccounts(client, companyId),
    client
      .from("dimension")
      .select("id, entityType")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true)
  ]);

  if (asset.error || !asset.data?.fixedAssetClass) {
    logger.error("Failed to get the fixed asset to register", {
      companyId,
      fixedAssetId,
      error: asset.error
    });
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }
  if (defaults.error) {
    logger.error("Failed to get the default accounts", {
      companyId,
      error: defaults.error
    });
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(defaults.error, "Failed to get the default accounts")
      )
    );
  }
  if (dimensionsResult.error) {
    logger.error("Failed to resolve dimensions", {
      companyId,
      error: dimensionsResult.error
    });
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(dimensionsResult.error, "Failed to resolve dimensions")
      )
    );
  }

  const assetClass = asset.data.fixedAssetClass;
  const dimensionId = (entityType: string) =>
    dimensionsResult.data.find((d) => d.entityType === entityType)?.id;

  try {
    // Capitalize the asset with a GL entry (Dr asset / Cr owner equity) rather
    // than a bare status flip, so no capitalized asset exists without a
    // journal. An asset in a construction-in-progress class is registered as
    // Under Construction: it accumulates cost until it is capitalized into its
    // in-service class, and is not depreciated before then.
    await postAssetRegistration(getDatabaseClient(), {
      fixedAssetId,
      fixedAssetReadableId: asset.data.fixedAssetId,
      registration,
      posting: {
        locationId: asset.data.locationId,
        fixedAssetClassId: asset.data.fixedAssetClassId,
        assetAccountId: assetClass.assetAccountId,
        accumulatedDepreciationAccountId:
          assetClass.accumulatedDepreciationAccountId,
        offsetAccountId: defaults.data.retainedEarningsAccount,
        locationDimensionId: dimensionId("Location"),
        assetClassDimensionId: dimensionId("FixedAssetClass"),
        resolveAccountingPeriodId: async (postingDate) => {
          const period = await getOrCreateAccountingPeriod(
            client,
            companyId,
            postingDate,
            "accounting"
          );
          if (period.error || !period.data) {
            throw new Error(
              period.error?.message ?? "Failed to get accounting period"
            );
          }
          return period.data;
        }
      },
      status: assetClass.isConstructionInProgress
        ? "Under Construction"
        : "Active",
      companyId,
      userId
    });
  } catch (err) {
    logger.error("Failed to register the fixed asset", {
      companyId,
      fixedAssetId,
      error: err
    });
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(err, getErrorMessage(err, "Failed to register asset"))
      )
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset registered successfully"))
  );
}

export default function RegisterFixedAssetRoute() {
  const closeRoute = useCloseRoute();

  return <FixedAssetRegisterForm onClose={() => closeRoute()} />;
}
