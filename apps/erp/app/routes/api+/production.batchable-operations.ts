import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getBatchableOperations } from "~/modules/production";
import type { BatchCandidate } from "~/modules/production/types";

// Statuses that count as "on the floor" for queue-load and hidden-op purposes.
const ACTIVE_STATUSES = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused"
] as const;

// Candidate operations for the batch builder (the batches-page wizard). Wraps the
// get_batchable_operations RPC — the same source the deleted schedule board used —
// and enriches each row with the op's time fields + due date (for the wizard's
// setup-saving/run-time/due-spread chips) and the job item's thumbnail, which the
// RPC omits. Rows carrying a jobOperationBatchId (Active/Completing lane members)
// are kept; the builder partitions client-side (add-to-batch targets, add-mode).
// Also returns workCenterLoad (active ops per WC at the location — the "N in
// queue" helper on the WC picker) and hiddenCount (ops on this process the RPC
// excluded: started or already batched).
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");
  const processId = url.searchParams.get("process");
  if (!locationId || !processId) {
    return Response.json(
      {
        candidates: [] as BatchCandidate[],
        workCenterLoad: {} as Record<string, number>,
        hiddenCount: 0
      },
      { status: 400 }
    );
  }

  const [operations, activeOps, processOpsCount] = await Promise.all([
    getBatchableOperations(client, { locationId, processId }),
    // Location-wide active ops with a work center → per-WC queue depth.
    client
      .from("jobOperation")
      .select("id, workCenterId, job!inner(locationId)")
      .eq("companyId", companyId)
      .eq("job.locationId", locationId)
      .in("status", [...ACTIVE_STATUSES])
      .not("workCenterId", "is", null),
    // All active-ish ops on this process at the location; the difference from
    // the RPC's rows is what the builder hides (started / already batched).
    client
      .from("jobOperation")
      .select("id, job!inner(locationId)", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("processId", processId)
      .eq("job.locationId", locationId)
      .in("status", [...ACTIVE_STATUSES])
  ]);

  const workCenterLoad: Record<string, number> = {};
  for (const op of activeOps.data ?? []) {
    if (!op.workCenterId) continue;
    workCenterLoad[op.workCenterId] =
      (workCenterLoad[op.workCenterId] ?? 0) + 1;
  }

  const rows = (operations.data ?? []) as unknown as BatchCandidate[];
  const hiddenCount = Math.max(0, (processOpsCount.count ?? 0) - rows.length);

  if (operations.error || rows.length === 0) {
    return { candidates: rows, workCenterLoad, hiddenCount };
  }

  // Enrich with the fields the RPC doesn't return but the wizard needs.
  const [opDetails, jobItems] = await Promise.all([
    client
      .from("jobOperation")
      .select(
        "id, setupTime, setupUnit, laborTime, laborUnit, machineTime, machineUnit, dueDate"
      )
      .in(
        "id",
        rows.map((r) => r.id)
      )
      .eq("companyId", companyId),
    client
      .from("job")
      .select("id, item(thumbnailPath)")
      .in("id", [...new Set(rows.map((r) => r.jobId))])
      .eq("companyId", companyId)
  ]);
  const detailById = new Map(
    (opDetails.data ?? []).map((d) => [d.id, d] as const)
  );
  const thumbnailByJobId = new Map(
    (jobItems.data ?? []).map(
      (j) => [j.id, j.item?.thumbnailPath ?? null] as const
    )
  );

  const candidates: BatchCandidate[] = rows.map((r) => {
    const d = detailById.get(r.id);
    return {
      ...r,
      setupTime: d?.setupTime ?? null,
      setupUnit: d?.setupUnit ?? null,
      laborTime: d?.laborTime ?? null,
      laborUnit: d?.laborUnit ?? null,
      machineTime: d?.machineTime ?? null,
      machineUnit: d?.machineUnit ?? null,
      dueDate: d?.dueDate ?? null,
      thumbnailPath: thumbnailByJobId.get(r.jobId) ?? null
    };
  });

  return { candidates, workCenterLoad, hiddenCount };
}
