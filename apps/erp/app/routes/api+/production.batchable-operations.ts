import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getBatchableOperations } from "~/modules/production";
import type { BatchCandidate, BatchMaterial } from "~/modules/production/types";

// The base candidate row, derived from the RPC wrapper's return so a column
// drift in get_batchable_operations fails to compile here (the type-chain
// convention) rather than silently through an `as unknown as` cast. The route
// enriches each row into a BatchCandidate below (setup/labor/machine time, due
// date, thumbnail) — fields the RPC does not return.
type BatchableOperationRow = NonNullable<
  Awaited<ReturnType<typeof getBatchableOperations>>["data"]
>[number];

// Statuses that count as "on the floor" for queue-load and hidden-op purposes.
const ACTIVE_STATUSES = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused"
] as const;

// The RPC only offers operations on released jobs — mirror its predicate so the
// hidden-op breakdown attributes the right reason.
const RELEASED_JOB_STATUSES = ["Ready", "In Progress", "Paused"] as const;

// What the builder tells the planner about ops the RPC excluded, per reason —
// a bare count mislabeled "started or batched" when the real reason was an
// unreleased (Draft/Planned) job, which is the common case.
export type HiddenOps = {
  total: number;
  unreleased: number;
  started: number;
  batched: number;
};

// Candidate operations for the batch builder (the batches-page wizard). Wraps the
// get_batchable_operations RPC — the same source the deleted schedule board used —
// and enriches each row with the op's time fields + due date (for the wizard's
// setup-saving/run-time/due-spread chips) and the job item's thumbnail, which the
// RPC omits. Rows carrying a jobOperationBatchId (Active/Completing lane members)
// are kept; the builder partitions client-side (add-to-batch targets, add-mode).
// Also returns workCenterLoad (active ops per WC at the location — the "N in
// queue" helper on the WC picker) and hidden (a per-reason breakdown of the ops
// on this process the RPC excluded).
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");
  const processId = url.searchParams.get("process");
  const emptyHidden: HiddenOps = {
    total: 0,
    unreleased: 0,
    started: 0,
    batched: 0
  };
  if (!locationId || !processId) {
    // Plain object (not Response.json) per the repo's no-Response.json-in-routes
    // convention — same shape the success path returns so the client fetcher
    // (candidatesFetcher.data) degrades gracefully instead of throwing on a 400.
    return {
      candidates: [] as BatchCandidate[],
      workCenterLoad: {} as Record<string, number>,
      hidden: emptyHidden,
      error: "A location and process are required"
    };
  }

  const [operations, activeOps, processOps] = await Promise.all([
    getBatchableOperations(client, companyId, { locationId, processId }),
    // Location-wide active ops with a work center → per-WC queue depth.
    client
      .from("jobOperation")
      .select("id, workCenterId, job!inner(locationId)")
      .eq("companyId", companyId)
      .eq("job.locationId", locationId)
      .in("status", [...ACTIVE_STATUSES])
      .not("workCenterId", "is", null),
    // All active-ish ops on this process at the location, with what's needed to
    // say WHY each one the RPC excluded is absent.
    client
      .from("jobOperation")
      .select("id, jobOperationBatchId, job!inner(locationId, status)")
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

  const rows: BatchableOperationRow[] = operations.data ?? [];
  const rpcIds = new Set(rows.map((r) => r.id));
  const hidden = { ...emptyHidden };
  for (const op of processOps.data ?? []) {
    if (rpcIds.has(op.id)) continue;
    hidden.total += 1;
    if (
      !(RELEASED_JOB_STATUSES as readonly string[]).includes(
        op.job?.status ?? ""
      )
    ) {
      hidden.unreleased += 1;
    } else if (op.jobOperationBatchId) {
      hidden.batched += 1;
    } else {
      // Released, unbatched, active-status — the only remaining exclusion is
      // the RPC's started guard (recorded productionEvent or in-progress).
      hidden.started += 1;
    }
  }

  if (operations.error || rows.length === 0) {
    // rows is always empty on this branch (error ⇒ data null ⇒ []), so there is
    // nothing to enrich into BatchCandidates.
    return { candidates: [] as BatchCandidate[], workCenterLoad, hidden };
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
    // Only `materials` crosses a real type boundary — the RPC row types it as
    // Json where BatchCandidate wants BatchMaterial[]; cast just that field so
    // the outer `as BatchCandidate` still catches drift on every other column.
    return {
      ...r,
      materials: (r.materials ?? []) as unknown as BatchMaterial[],
      setupTime: d?.setupTime ?? null,
      setupUnit: d?.setupUnit ?? null,
      laborTime: d?.laborTime ?? null,
      laborUnit: d?.laborUnit ?? null,
      machineTime: d?.machineTime ?? null,
      machineUnit: d?.machineUnit ?? null,
      dueDate: d?.dueDate ?? null,
      thumbnailPath: thumbnailByJobId.get(r.jobId) ?? null
    } as BatchCandidate;
  });

  return { candidates, workCenterLoad, hidden };
}
