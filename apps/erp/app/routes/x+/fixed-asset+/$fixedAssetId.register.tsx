// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
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

  const [companySettings, asset] = await Promise.all([
    getCompanySettings(client, companyId),
    client
      .from("fixedAsset")
      .select(
        "fixedAssetId, locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId, accumulatedDepreciationAccountId, isConstructionInProgress)"
      )
      .eq("id", fixedAssetId)
      .eq("companyId", companyId)
      .single()
  ]);

  if (companySettings.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(companySettings.error, "Failed to load company settings")
      )
    );
  }
  if (asset.error || !asset.data) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  // Every company posts the registration journal: Provisional before the
  // accounting cutover (no period), Posted after it
  // (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 1).
  const postingStatus = await journalPostingStatus(
    getDatabaseClient(),
    companyId
  );

  const assetClass = asset.data.fixedAssetClass as {
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    isConstructionInProgress: boolean;
  } | null;

  // An asset in a construction-in-progress class is registered as Under
  // Construction rather than Active: it accumulates cost until it is
  // capitalized into its in-service class, and is not depreciated before then.
  const registeredStatus = assetClass?.isConstructionInProgress
    ? "Under Construction"
    : "Active";

  // Capitalize the asset with a GL entry (Dr asset / Cr owner equity) rather
  // than a bare status flip, so no capitalized asset exists without a journal.
  const [defaults, dimensionsResult, accountingPeriod] = await Promise.all([
    getDefaultAccounts(client, companyId),
    client
      .from("dimension")
      .select("id, entityType")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true),
    postingStatus === "Posted"
      ? getOrCreateAccountingPeriod(
          client,
          companyId,
          registration.acquisitionDate,
          "accounting"
        )
      : Promise.resolve({ data: null, error: null })
  ]);

  if (
    postingStatus === "Posted" &&
    (accountingPeriod.error || !accountingPeriod.data)
  ) {
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

  // A Provisional journal counts nowhere, so a missing dimension does not
  // block a company that has not set up accounting.
  if (
    postingStatus === "Posted" &&
    (!locationDimensionId || !assetClassDimensionId)
  ) {
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
      posting: {
        postingStatus,
        locationId: asset.data.locationId,
        fixedAssetClassId: asset.data.fixedAssetClassId,
        assetAccountId,
        accumulatedDepreciationAccountId,
        offsetAccountId,
        accountingPeriodId: accountingPeriod.data ?? null,
        locationDimensionId,
        assetClassDimensionId
      },
      status: registeredStatus,
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

export default function RegisterFixedAssetRoute() {
  const closeRoute = useCloseRoute();

  return <FixedAssetRegisterForm onClose={() => closeRoute()} />;
}
