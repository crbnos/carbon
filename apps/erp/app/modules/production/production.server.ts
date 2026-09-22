import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import {
  getJobReleaseReadiness,
  recalculateJobRequirements,
  runMRP,
  updateJobStatus
} from "./production.service";

// The geometry (assembler) service backs model conversion and motion planning.
// When it's unreachable those actions can't run, so loaders probe its health and
// the UI soft-gates the assembler-dependent controls. Result cached so a
// navigation burst doesn't fan out one probe per route.
//
// The default deployment is a scale-to-zero Lambda: a cold /health takes ~2-5s
// to init, so the probe timeout must outlast a cold start (the old 2s abort
// read every cold service as down). Healthy sticks longer than unhealthy —
// a failed probe usually WARMED the service (the request went through; we just
// stopped waiting), so re-probe quickly instead of pinning "down" for 15s.
const ASSEMBLER_HEALTHY_TTL_MS = 60_000;
const ASSEMBLER_UNHEALTHY_TTL_MS = 5_000;
const ASSEMBLER_HEALTH_TIMEOUT_MS = 10_000;
let assemblerHealthCache: { healthy: boolean; expires: number } | null = null;

export async function isAssemblerServiceHealthy(): Promise<boolean> {
  if (!ASSEMBLER_SERVICE_URL) return false;

  const now = Date.now();
  if (assemblerHealthCache && assemblerHealthCache.expires > now) {
    return assemblerHealthCache.healthy;
  }

  let healthy = false;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ASSEMBLER_HEALTH_TIMEOUT_MS
  );
  try {
    const response = await fetch(`${ASSEMBLER_SERVICE_URL}/health`, {
      method: "GET",
      signal: controller.signal
    });
    healthy = response.ok;
  } catch {
    healthy = false;
  } finally {
    clearTimeout(timeout);
  }

  assemblerHealthCache = {
    healthy,
    expires:
      now + (healthy ? ASSEMBLER_HEALTHY_TTL_MS : ASSEMBLER_UNHEALTHY_TTL_MS)
  };
  return healthy;
}

// Release jobs to the floor: the one path the job page and batch release share.
// Per job, in order: refresh requirements, run MRP, flip to Ready, put outside
// operations on purchase orders, stamp releasedDate. Scheduling is the
// caller's (one location run, or a notify, after all jobs are released).
//
// `purchaseOrdersBySupplierId` maps a supplier to "new" or a Draft PO id; a
// supplier's first "new" PO is reused for the jobs after it, so a batch puts
// each supplier's outside operations from every member job on one PO.
// Validation (getJobReleaseReadiness) is the caller's, BEFORE this runs.
export async function releaseJobs({
  client,
  db,
  jobIds,
  companyId,
  userId,
  purchaseOrdersBySupplierId
}: {
  client: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  jobIds: string[];
  companyId: string;
  userId: string;
  purchaseOrdersBySupplierId: Record<string, string>;
}): Promise<{ error: string | null }> {
  const serviceRole = getCarbonServiceRole();
  const purchaseOrders = { ...purchaseOrdersBySupplierId };

  for (const id of jobIds) {
    const recalc = await recalculateJobRequirements(serviceRole, {
      id,
      companyId,
      userId
    });
    if (recalc.error) return { error: `Failed to recalculate job ${id}` };

    await runMRP(serviceRole, db, { type: "job", id, companyId, userId });

    const update = await updateJobStatus(client, {
      id,
      companyId,
      status: "Ready",
      updatedBy: userId
    });
    if (update.error) return { error: `Failed to release job ${id}` };

    const purchaseOrder = await serviceRole.functions.invoke<{
      purchaseOrderIdsBySupplierId?: Record<string, string>;
    }>("create", {
      body: {
        type: "purchaseOrderFromJob",
        jobId: id,
        purchaseOrdersBySupplierId: purchaseOrders,
        companyId,
        userId
      }
    });
    if (purchaseOrder.error) {
      return {
        error: await getEdgeFunctionErrorMessage(
          purchaseOrder.error,
          `Failed to create purchase orders for job ${id}`
        )
      };
    }
    Object.assign(
      purchaseOrders,
      purchaseOrder.data?.purchaseOrderIdsBySupplierId ?? {}
    );

    await client
      .from("job")
      .update({ releasedDate: datetime.timestamp() })
      .eq("id", id)
      .eq("companyId", companyId);
  }
  return { error: null };
}

// Releasing a batch releases its Draft/Planned member jobs through the same
// path as the job page: every one is validated first and ANY problem refuses the
// whole batch before anything changes. `purchaseOrdersBySupplierId` is the
// planner's PO choice from the Release dialog; unattended callers (bulk release)
// pass none, and a batch that needs a choice — a supplier with Draft POs to pick
// from — is refused so the planner can release it from its dialog.
export async function releaseBatchMemberJobs({
  client,
  db,
  jobIds,
  companyId,
  userId,
  purchaseOrdersBySupplierId
}: {
  client: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  jobIds: string[];
  companyId: string;
  userId: string;
  purchaseOrdersBySupplierId?: Record<string, string>;
}): Promise<{ error: string | null }> {
  const jobs = await client
    .from("job")
    .select("id, status")
    .in("id", [...new Set(jobIds)])
    .eq("companyId", companyId);
  if (jobs.error) return { error: "Failed to load the batch's jobs" };

  const toRelease = (jobs.data ?? [])
    .filter((job) => job.status === "Draft" || job.status === "Planned")
    .map((job) => job.id);
  if (toRelease.length === 0) return { error: null };

  const readiness = await getJobReleaseReadiness(client, toRelease, companyId);
  if (readiness.error || !readiness.data) {
    return { error: "Failed to validate the batch's jobs" };
  }

  const problems = readiness.data.jobs.flatMap((job) => [
    ...(job.manufacturingBlocked
      ? [`${job.jobId}: manufacturing is blocked`]
      : []),
    ...(job.missingAssemblies.length > 0
      ? [
          `${job.jobId}: no operations on ${job.missingAssemblies
            .map((m) => m.description)
            .join(", ")}`
        ]
      : []),
    // No per-operation supplier picker here: an ambiguous or missing supplier
    // is settled on the job's own Release.
    ...job.outsideOperationsWithoutSupplier.map((op) =>
      op.missing === "choose"
        ? `${job.jobId}: choose a supplier for ${op.description} on the job`
        : `${job.jobId}: ${op.description} has no supplier`
    )
  ]);
  if (problems.length > 0) {
    return { error: `Fix these jobs before releasing: ${problems.join("; ")}` };
  }

  if (
    !purchaseOrdersBySupplierId &&
    readiness.data.suppliers.some((s) => s.draftPurchaseOrders.length > 0)
  ) {
    return {
      error:
        "Outside operations need a purchase order choice — open the batch to release it"
    };
  }

  // Only a Draft PO of that supplier is a valid target; anything else is "new".
  const purchaseOrders = Object.fromEntries(
    readiness.data.suppliers.map((supplier) => {
      const picked = purchaseOrdersBySupplierId?.[supplier.supplierId];
      return [
        supplier.supplierId,
        picked && supplier.draftPurchaseOrders.some((po) => po.id === picked)
          ? picked
          : "new"
      ];
    })
  );

  return releaseJobs({
    client,
    db,
    jobIds: toRelease,
    companyId,
    userId,
    purchaseOrdersBySupplierId: purchaseOrders
  });
}
