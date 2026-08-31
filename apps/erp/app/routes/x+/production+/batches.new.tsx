import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { BatchRules } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  getBatchableProcesses,
  getJobOperationBatchWithMembers
} from "~/modules/production";
import { BatchBuilder } from "~/modules/production/ui/Batches/BatchBuilder";
import { getLocationsList, getWorkCentersList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const url = new URL(request.url);
  const batchId = url.searchParams.get("batchId");

  const [processes, locations, workCenters, userDefaults] = await Promise.all([
    getBatchableProcesses(client, companyId),
    getLocationsList(client, companyId),
    getWorkCentersList(client, companyId),
    getUserDefaults(client, userId, companyId)
  ]);

  const defaultLocationId =
    userDefaults.data?.locationId ?? locations.data?.[0]?.id ?? "";

  // Deep-linkable scope (?location=&process=) — validated against the loaded
  // lists so a stale link falls back silently instead of scoping to nothing.
  const paramLocation = url.searchParams.get("location");
  const paramProcess = url.searchParams.get("process");
  const initialLocationId =
    paramLocation && locations.data?.some((l) => l.id === paramLocation)
      ? paramLocation
      : null;
  const initialProcessId =
    paramProcess && processes.data?.some((p) => p.id === paramProcess)
      ? paramProcess
      : null;

  // Add-mode: pre-scope to an existing Active batch. A Completing/Completed
  // batch can't take members — bounce back to its drawer.
  let batch: {
    id: string;
    readableId: string;
    processId: string;
    locationId: string;
    members: {
      id: string;
      jobReadableId: string | null;
      itemReadableId: string | null;
      description: string | null;
      operationQuantity: number | null;
    }[];
  } | null = null;

  if (batchId) {
    const result = await getJobOperationBatchWithMembers(
      client,
      batchId,
      companyId
    );
    if (result.error || !result.data) {
      throw redirect(
        path.to.operationBatches,
        await flash(request, error(result.error, "Failed to load batch"))
      );
    }
    if (result.data.status !== "Active") {
      throw redirect(
        path.to.operationBatch(batchId),
        await flash(
          request,
          error(null, "Only an active batch can take more operations")
        )
      );
    }
    batch = {
      id: result.data.id,
      readableId: result.data.readableId,
      processId: result.data.processId,
      locationId: result.data.locationId,
      members: (result.data.members ?? []).map((m) => ({
        id: m.id,
        jobReadableId: m.job?.jobId ?? null,
        itemReadableId: m.jobMakeMethod?.item?.readableIdWithRevision ?? null,
        description: m.description,
        operationQuantity: m.operationQuantity
      }))
    };
  }

  return {
    processes: (processes.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      batchRules: (p.batchRules ?? null) as BatchRules | null
    })),
    locations: (locations.data ?? []).map((l) => ({ id: l.id, name: l.name })),
    workCenters: (workCenters.data ?? [])
      .filter((wc): wc is typeof wc & { id: string; name: string } =>
        Boolean(wc.id && wc.name)
      )
      .map((wc) => ({
        id: wc.id,
        name: wc.name,
        locationId: wc.locationId,
        // Which processes this center can run (workCenterProcess links, from
        // the view) — the builder's picker filters on the scoped process.
        processes: (wc.processes as string[] | null) ?? [],
        batchCapacity: wc.batchCapacity,
        minimumBatchQuantity: wc.minimumBatchQuantity
      })),
    defaultLocationId,
    initialLocationId,
    initialProcessId,
    batch
  };
}

export default function NewBatchRoute() {
  const {
    processes,
    locations,
    workCenters,
    defaultLocationId,
    initialLocationId,
    initialProcessId,
    batch
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <BatchBuilder
      onClose={() => navigate(-1)}
      defaultLocationId={defaultLocationId}
      initialLocationId={initialLocationId}
      initialProcessId={initialProcessId}
      locations={locations}
      processes={processes}
      workCenters={workCenters}
      batch={batch}
    />
  );
}
