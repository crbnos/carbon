// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useUrlParams, useUser } from "~/hooks";
import {
  CONSTRUCTION_IN_PROGRESS_ENABLED,
  getFixedAssets
} from "~/modules/accounting";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.server";
import {
  insertJob,
  jobValidator,
  makeToAssetItemError
} from "~/modules/production";
import { JobForm } from "~/modules/production/ui/Jobs";
import type { MethodItemType } from "~/modules/shared";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
    role: "employee"
  });

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, configuration: configStr, ...data } = validation.data;

  let configuration: Record<string, unknown> | undefined;
  if (configStr) {
    try {
      configuration = JSON.parse(configStr);
    } catch {
      // invalid JSON — skip configuration
    }
  }

  // insertJob runs with the service role, so every foreign-key id in the form
  // is proven to belong to this company before it is written.
  const serviceRole = getCarbonServiceRole();
  await Promise.all([
    requireCompanyRecord(serviceRole, "item", companyId, { id: data.itemId }),
    requireCompanyRecord(serviceRole, "location", companyId, {
      id: data.locationId
    }),
    data.customerId
      ? requireCompanyRecord(serviceRole, "customer", companyId, {
          id: data.customerId
        })
      : null,
    data.modelUploadId
      ? requireCompanyRecord(serviceRole, "modelUpload", companyId, {
          id: data.modelUploadId
        })
      : null,
    data.fixedAssetClassId
      ? requireCompanyRecord(serviceRole, "fixedAssetClass", companyId, {
          id: data.fixedAssetClassId
        })
      : null,
    data.fixedAssetId
      ? requireCompanyRecord(serviceRole, "fixedAsset", companyId, {
          id: data.fixedAssetId
        })
      : null
  ]);

  // A job pulls the item's active make method, and for an item a change notice
  // still holds that is the notice's un-approved draft BOM. Refuse the job until
  // the notice releases. Checked here rather than only in the picker because this
  // action is also reached by the API and the MCP tools.
  if (data.itemId) {
    const unreleasedIssue = await getUnreleasedChangeOrderIssue(serviceRole, {
      itemId: data.itemId,
      companyId
    });
    if (unreleasedIssue) {
      return validationError({
        fieldErrors: {
          itemId: `${unreleasedIssue} A job cannot be made for it.`
        }
      });
    }
  }

  // A Make to Asset job is refused here, not only at release, so the form
  // says why while the item is still being chosen.
  if (data.fixedAssetClassId || data.fixedAssetId) {
    const item = await serviceRole
      .from("item")
      .select("itemTrackingType")
      .eq("id", data.itemId)
      .eq("companyId", companyId)
      .single();
    const itemError = makeToAssetItemError({
      ...data,
      itemTrackingType: item.data?.itemTrackingType
    });
    if (itemError) {
      return validationError({ fieldErrors: { itemId: itemError } });
    }
  }

  const result = await insertJob(
    serviceRole,
    getDatabaseClient(),
    {
      ...data,
      jobId: data.jobId || undefined,
      fixedAssetClassId: data.fixedAssetClassId || null,
      fixedAssetId: data.fixedAssetId || null,
      configuration,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData)
    },
    { source: "erp" }
  );

  if (result.error || !result.data) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(result.error, "Failed to insert job"))
    );
  }

  throw redirect(path.to.job(result.data.id));
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
