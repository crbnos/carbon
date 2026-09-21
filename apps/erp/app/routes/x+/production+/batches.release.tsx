import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  notifyScheduleInputsChanged,
  releaseJobOperationBatch
} from "~/modules/production";
import { releaseBatchMemberJobs } from "~/modules/production/production.server";
import { getDatabaseClient } from "~/services/database.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";

// Bulk release — one release per selected Planned batch. Each is independent:
// a batch the edge fn refuses (no members, already recorded production) is
// reported in `failed` while the rest still release. Only Planned batches are
// released — the caller filters, and any non-Planned id is refused here too so a
// stale selection can't flip an Active/Completing batch. Fetcher-driven; the
// table toasts the summary and the loader revalidates.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { batchIds } = (await request.json()) as { batchIds?: string[] };
  const ids = [...new Set((batchIds ?? []).filter(Boolean))];
  if (ids.length === 0) {
    return { success: false, message: "No batches selected" };
  }

  // Resolve readable ids + status + work center up front: failures name the
  // batch (not its nanoid), we only release Planned batches, and the notify
  // needs the work center.
  const rows = await client
    .from("jobOperationBatch")
    .select("id, readableId, status, workCenterId")
    .in("id", ids)
    .eq("companyId", companyId);
  if (rows.error) {
    return { success: false, message: "Failed to load the selected batches" };
  }
  const batchById = new Map((rows.data ?? []).map((r) => [r.id, r] as const));

  let released = 0;
  const failed: { readableId: string; message: string }[] = [];
  for (const batchId of ids) {
    const batch = batchById.get(batchId);
    if (!batch || batch.status !== "Planned") {
      // Silently skip a stale selection — nothing was released, nothing failed.
      continue;
    }

    const members = await client
      .from("jobOperation")
      .select("jobId")
      .eq("jobOperationBatchId", batchId)
      .eq("companyId", companyId);
    if (members.error) {
      failed.push({
        readableId: batch.readableId,
        message: "Failed to load the batch members"
      });
      continue;
    }

    // Member jobs release first, through the job page's release path. With no
    // dialog here, a batch with an invalid job or a PO choice to make is
    // skipped and named — the planner releases it from its drawer.
    const releasedJobs = await releaseBatchMemberJobs({
      client,
      db: getDatabaseClient(),
      jobIds: (members.data ?? []).map((op) => op.jobId),
      companyId,
      userId
    });
    if (releasedJobs.error) {
      failed.push({
        readableId: batch.readableId,
        message: releasedJobs.error
      });
      continue;
    }

    const result = await releaseJobOperationBatch(client, {
      batchId,
      companyId,
      userId
    });
    if (result.error) {
      failed.push({
        readableId: batch.readableId,
        message: await getEdgeFunctionErrorMessage(
          result.error,
          "Failed to release"
        )
      });
      continue;
    }

    // After the status flip is persisted — the wave must see the new state.
    await notifyScheduleInputsChanged(
      companyId,
      "work-center",
      "batch released",
      batch.workCenterId ?? undefined
    );
    released += 1;
  }

  return { success: true, released, failed };
}
