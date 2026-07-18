import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import type { BatchOperation } from "~/modules/production";
import {
  batchOperations,
  getBatchableOperations,
  getJobOperationBatches,
  getJobOperationsByBatch
} from "~/modules/production";
import { BatchPlanningBoard } from "~/modules/production/ui/BatchPlanning";
import {
  getLocationsList,
  getWorkCentersByLocation
} from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Batch Planning`,
  to: path.to.batchPlanning,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.production,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }
    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data[0].id as string;
  }

  const [candidates, batchesResult, workCenters] = await Promise.all([
    getBatchableOperations(client, locationId, companyId),
    getJobOperationBatches(client, companyId, locationId),
    getWorkCentersByLocation(client, locationId)
  ]);

  const batches = batchesResult.data ?? [];
  const members = await getJobOperationsByBatch(
    client,
    companyId,
    batches.map((b) => b.id)
  );

  return {
    candidates: candidates.data ?? [],
    batches,
    members: members.data ?? [],
    workCenters: (workCenters.data ?? [])
      .filter((wc) => wc.id)
      .map((wc) => ({ id: wc.id as string, name: wc.name ?? "" })),
    locationId
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  const ids = (name: string) =>
    String(formData.get(name) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  let params: BatchOperation;
  switch (intent) {
    case "create":
      params = {
        type: "create",
        processId: String(formData.get("processId")),
        locationId: String(formData.get("locationId")),
        workCenterId: (formData.get("workCenterId") as string) || null,
        jobOperationIds: ids("jobOperationIds")
      };
      break;
    case "add":
      params = {
        type: "add",
        jobOperationBatchId: String(formData.get("jobOperationBatchId")),
        jobOperationIds: ids("jobOperationIds")
      };
      break;
    case "remove":
      params = {
        type: "remove",
        jobOperationBatchId: String(formData.get("jobOperationBatchId")),
        jobOperationIds: ids("jobOperationIds")
      };
      break;
    case "updateWorkCenter":
      params = {
        type: "updateWorkCenter",
        jobOperationBatchId: String(formData.get("jobOperationBatchId")),
        workCenterId: (formData.get("workCenterId") as string) || null
      };
      break;
    case "dissolve":
      params = {
        type: "dissolve",
        jobOperationBatchId: String(formData.get("jobOperationBatchId"))
      };
      break;
    default:
      return data(
        { success: false },
        await flash(request, error(null, "Unknown batch action"))
      );
  }

  // The batch-operations edge function owns the eligibility gate + transactional
  // writes; it accepts a service-role JWT (this route's requirePermissions above
  // is the real auth gate). Mirrors the `mrp` invoke pattern.
  const result = await batchOperations(getCarbonServiceRole(), {
    ...params,
    companyId,
    userId
  });

  const failure = result.error?.message ?? result.data?.error;
  if (failure || result.data?.success === false) {
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, failure ?? "Batch action failed")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Batch updated"))
  );
}

export default function BatchPlanningRoute() {
  const { candidates, batches, members, workCenters, locationId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <BatchPlanningBoard
        candidates={candidates}
        batches={batches}
        members={members}
        workCenters={workCenters}
        locationId={locationId}
      />
    </VStack>
  );
}
