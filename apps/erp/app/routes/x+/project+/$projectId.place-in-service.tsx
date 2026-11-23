// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { placeInServiceValidator } from "~/modules/projects/projects.models";
import { getProjectCapitalAssets } from "~/modules/projects/projects.service";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
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
 * Capitalizes each selected asset (`projects.placeProjectAssetsInService`):
 * one result per asset, with its refusal when it stayed under construction.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<PlaceInServiceResult> {
  assertIsPost(request);
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

  const api = await carbon(request);
  const result = await api.projects.placeProjectAssetsInService({
    ...validation.data,
    projectId
  });
  if (result.error) {
    return {
      results: [{ fixedAssetId: "", label: "", error: result.error.message }]
    };
  }
  return result.data;
}
