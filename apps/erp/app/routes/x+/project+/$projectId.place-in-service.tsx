// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime, getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { invokeAssetTransfer } from "~/modules/accounting/accounting.service";
import { placeInServiceValidator } from "~/modules/projects/projects.models";
import {
  completeElementSubtrees,
  getProjectCapitalAssets
} from "~/modules/projects/projects.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-place-in-service");

export type PlaceInServiceResult = {
  results: { fixedAssetId: string; label: string; error: string | null }[];
};

/** The project's assets under construction and the in-service classes. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["projects", "accounting"]
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [assets, assetClasses, timeZone] = await Promise.all([
    getProjectCapitalAssets(getDatabaseClient(), { companyId, projectId }),
    // The in-service classes. `getFixedAssetClassesList` drops CIP classes
    // only while CONSTRUCTION_IN_PROGRESS_ENABLED is false, so filter here.
    client
      .from("fixedAssetClass")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("isConstructionInProgress", false)
      .order("name"),
    getCompanyTimeZone(client, companyId)
  ]);
  if (assetClasses.error) {
    logger.error("Failed to load the fixed asset classes", {
      companyId,
      projectId,
      error: assetClasses.error
    });
  }

  return {
    assets: assets.filter((asset) => asset.status === "Under Construction"),
    assetClasses: assetClasses.data ?? [],
    inServiceDate: datetime.today(timeZone).toString()
  };
}

/**
 * Capitalizes each selected asset (post-asset-transfer `capitalizeCip`), one
 * transfer document per asset. An asset that fails stays under construction;
 * the others stay capitalized. A final-asset element whose asset went into
 * service moves, with its descendants, to the default Completed state.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<PlaceInServiceResult> {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects",
    create: "accounting"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const validation = await validator(placeInServiceValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return {
      results: [
        { fixedAssetId: "", label: "", error: "Select an asset and a class" }
      ]
    };
  }
  const { fixedAssetIds, toClassId, inServiceDate } = validation.data;

  const db = getDatabaseClient();
  const assets = await getProjectCapitalAssets(db, { companyId, projectId });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const results: PlaceInServiceResult["results"] = [];
  // One transfer document per asset, each in its own transaction, so one
  // refusal leaves the others capitalized.
  for (const fixedAssetId of fixedAssetIds) {
    const asset = assetById.get(fixedAssetId);
    if (!asset) {
      results.push({
        fixedAssetId,
        label: fixedAssetId,
        error: "The asset is not part of this project"
      });
      continue;
    }
    const label = `${asset.fixedAssetId} ${asset.name}`;
    const result = await invokeAssetTransfer(client, db, {
      type: "capitalizeCip",
      companyId,
      userId,
      fixedAssetId,
      toClassId,
      inServiceDate
    });
    if (result.error) {
      logger.error("Failed to place an asset in service", {
        companyId,
        projectId,
        fixedAssetId,
        error: result.error
      });
    }
    results.push({
      fixedAssetId,
      label,
      error: result.error
        ? getErrorMessage(result.error, "Failed to capitalize the asset")
        : null
    });
  }

  const placedElementIds = results
    .filter((result) => !result.error)
    .map((result) => assetById.get(result.fixedAssetId)?.elementId)
    .filter((id): id is string => Boolean(id));
  try {
    await completeElementSubtrees(db, {
      companyId,
      projectId,
      elementIds: placedElementIds,
      userId
    });
  } catch (err) {
    logger.error("Failed to complete the placed elements", {
      companyId,
      projectId,
      error: err
    });
  }

  return { results };
}
