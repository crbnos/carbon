// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetCapitalizeValidator,
  getCapitalizationCost,
  getDefaultAccounts,
  invokeAssetTransfer
} from "~/modules/accounting";
import { FixedAssetCapitalizeForm } from "~/modules/accounting/ui/FixedAssets";
import { getTrackedEntity } from "~/modules/inventory";
import { getItem } from "~/modules/items";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "fixed-asset-capitalize");

// The name the function derives when none is given — shown so the user can
// see (and change) what the asset will be called.
const RENTAL_FLEET_CLASS_NAME = "Rental Fleet";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "accounting"
  });

  const searchParams = new URL(request.url).searchParams;
  const itemId = searchParams.get("itemId");
  const trackedEntityId = searchParams.get("trackedEntityId");
  const locationId = searchParams.get("locationId");
  const storageUnitId = searchParams.get("storageUnitId");

  if (!itemId || !trackedEntityId || !locationId) {
    throw redirect(
      path.to.fixedAssets,
      await flash(
        request,
        error(
          null,
          "Choose a serialized unit from the item's inventory to capitalize"
        )
      )
    );
  }

  const [
    entity,
    item,
    capitalization,
    assetClasses,
    timeZone,
    accountDefaults
  ] = await Promise.all([
    getTrackedEntity(client, trackedEntityId),
    getItem(client, itemId),
    getCapitalizationCost(client, getDatabaseClient(), {
      companyId,
      userId,
      trackedEntityId
    }),
    // A CIP class is a holding account, never a capitalization target.
    // `getFixedAssetClassesList` does not select `isConstructionInProgress`,
    // so the filter is applied here (same select as `x+/job+/new.tsx`).
    client
      .from("fixedAssetClass")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("isConstructionInProgress", false)
      .order("name"),
    getCompanyTimeZone(client, companyId),
    getDefaultAccounts(client, companyId)
  ]);

  if (
    entity.error ||
    entity.data.companyId !== companyId ||
    entity.data.itemId !== itemId
  ) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(entity.error, "Tracked entity not found"))
    );
  }

  if (item.error || item.data.companyId !== companyId) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(item.error, "Item not found"))
    );
  }

  if (capitalization.error) {
    logger.error("Failed to preview the capitalization cost", {
      companyId,
      trackedEntityId,
      error: capitalization.error
    });
  }

  const classes = assetClasses.data ?? [];
  const rentalFleetClassId =
    classes.find((c) => c.name === RENTAL_FLEET_CLASS_NAME)?.id ?? "";
  const serialNumber = entity.data.readableId;

  return {
    initialValues: {
      fixedAssetClassId: rentalFleetClassId,
      itemId,
      trackedEntityId,
      locationId,
      storageUnitId: storageUnitId ?? "",
      transferDate: datetime.today(timeZone).toString(),
      name: [item.data.name, serialNumber].filter(Boolean).join(" "),
      // Used only when the unit carries no cost: the value is booked from
      // Retained Earnings unless the accountant picks the account it was
      // spent from this year.
      offsetAccountId: accountDefaults.data?.retainedEarningsAccount ?? ""
    },
    assetClasses: classes,
    item: {
      readableId: item.data.readableIdWithRevision ?? item.data.readableId,
      name: item.data.name
    },
    serialNumber,
    // What the transfer will book; null when the preview failed, in which
    // case the function itself still decides.
    cost: capitalization.error ? null : capitalization.data.cost
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(fixedAssetCapitalizeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { storageUnitId, name, cost, offsetAccountId, ...transfer } =
    validation.data;

  const result = await invokeAssetTransfer(client, getDatabaseClient(), {
    type: "capitalize",
    companyId,
    userId,
    ...transfer,
    storageUnitId: storageUnitId || null,
    name: name || null,
    cost: cost ?? null,
    offsetAccountId: cost ? offsetAccountId || null : null
  });

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to capitalize the unit")
        )
      )
    );
  }

  const fixedAssetId = (result.data as { fixedAssetId?: string } | null)
    ?.fixedAssetId;
  if (!fixedAssetId) {
    return data(
      {},
      await flash(request, error(null, "Failed to capitalize the unit"))
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset capitalized"))
  );
}

export default function CapitalizeFixedAssetRoute() {
  const { initialValues, assetClasses, item, serialNumber, cost } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <FixedAssetCapitalizeForm
      initialValues={initialValues}
      assetClasses={assetClasses}
      item={item}
      serialNumber={serialNumber}
      cost={cost}
      onClose={() => navigate(-1)}
    />
  );
}
