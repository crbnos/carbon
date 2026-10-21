// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useUrlParams, useUser } from "~/hooks";
import { CONSTRUCTION_IN_PROGRESS_ENABLED } from "~/modules/accounting/accounting.models";
import { getFixedAssets } from "~/modules/accounting/accounting.service";
import { jobValidator } from "~/modules/production/production.models";
import { JobForm } from "~/modules/production/ui/Jobs";
import type { MethodItemType } from "~/modules/shared/types";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.jobs,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  // The Complete To pickers. A CIP class is the holding account a job's cost
  // sits in, never a target, so it is filtered out here rather than by name.
  const [fixedAssetClasses, underConstructionAssets] = await Promise.all([
    client
      .from("fixedAssetClass")
      .select("id, name, isConstructionInProgress")
      .eq("companyId", companyId)
      .eq("isConstructionInProgress", false)
      .order("name"),
    // Not offered while construction in progress is hidden.
    CONSTRUCTION_IN_PROGRESS_ENABLED
      ? getFixedAssets(client, companyId, {
          search: null,
          status: "Under Construction",
          limit: 100,
          offset: 0,
          sorts: [],
          filters: []
        })
      : null
  ]);

  return {
    fixedAssetClasses: (fixedAssetClasses.data ?? []).map((assetClass) => ({
      id: assetClass.id,
      name: assetClass.name
    })),
    underConstructionAssets: (underConstructionAssets?.data ?? []).map(
      (asset) => ({
        id: asset.id,
        fixedAssetId: asset.fixedAssetId,
        name: asset.name
      })
    )
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(jobValidator).request(args);
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  const result = await api.production.createJob({
    ...input.data,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  // The item cannot be made (a change notice holds it, or it cannot complete
  // to an asset): say so on the item field.
  if (result.error?.category === "rule") {
    return validationError({ fieldErrors: { itemId: result.error.message } });
  }
  if (result.error) {
    return respond(args.request, result).redirect(path.to.jobs);
  }
  throw redirect(path.to.job(result.data.jobId));
}

export default function JobNewRoute() {
  const { fixedAssetClasses, underConstructionAssets } =
    useLoaderData<typeof loader>();
  const { defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  // "Build for fleet" opens this page with the class preselected.
  const fixedAssetClassId = params.get("fixedAssetClassId");

  const initialValues = {
    customerId: customerId ?? "",
    deadlineType: "No Deadline" as const,
    description: "",
    dueDate: "",
    fixedAssetClassId: fixedAssetClassId ?? "",
    fixedAssetId: "",
    itemId: "",
    itemType: "Item" as MethodItemType,
    jobId: undefined,
    locationId: defaults?.locationId ?? "",
    quantity: 1,
    scrapQuantity: 0,
    status: "Draft" as const,
    unitOfMeasureCode: "EA"
  };

  return (
    <NewRecordPage>
      <JobForm
        initialValues={initialValues}
        fixedAssetClasses={fixedAssetClasses}
        underConstructionAssets={underConstructionAssets}
      />
    </NewRecordPage>
  );
}
