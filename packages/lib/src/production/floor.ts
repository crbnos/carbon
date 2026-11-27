// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Whether an operation may start here and now: the floor rule (its job or
// batch is released), the work center it runs on, and a maintenance block on
// that work center. The timer Start, the kanban Start and the MES screens
// share them, so a screen offers Start only where the server allows it.

import type { Database } from "@carbon/database";
import { activeJobStatuses } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = getLogger("lib", "production-timer");

type Client = SupabaseClient<Database>;

/**
 * The floor rule on statuses already read: a batched operation needs its
 * batch released (not Planned); an unbatched one needs its job released
 * (`activeJobStatuses`). The refusal text, or null.
 */
export function floorRule(state: {
  jobOperationBatchId: string | null | undefined;
  batchStatus?: string | null;
  jobStatus?: string | null;
}): string | null {
  if (state.jobOperationBatchId) {
    return state.batchStatus === "Planned"
      ? "This operation is part of a batch that has not been released to the floor"
      : null;
  }
  return state.jobStatus &&
    (activeJobStatuses as readonly string[]).includes(state.jobStatus)
    ? null
    : "This operation's job has not been released to the floor";
}

type FloorArgs = {
  companyId: string;
  jobId: string;
  jobOperationBatchId: string | null | undefined;
  jobStatus?: string | null;
};

/**
 * `floorRule`, reading the batch or the job. Pass `jobStatus` when the caller
 * already read the job. A failed read refuses: an unread status proves nothing.
 */
export async function floorRuleRefusal(
  client: Client,
  args: FloorArgs
): Promise<string | null> {
  return (await floorCheck(client, args)).refusal;
}

type BatchStatus = Database["public"]["Enums"]["jobOperationBatchStatus"];

/** `floorRuleRefusal` with the batch status it read (null when not batched). */
export async function floorCheck(
  client: Client,
  args: FloorArgs
): Promise<{ refusal: string | null; batchStatus: BatchStatus | null }> {
  const noBatchStatus = (text: string | null) => ({
    refusal: text,
    batchStatus: null
  });
  const { companyId, jobOperationBatchId } = args;
  if (jobOperationBatchId) {
    const batch = await client
      .from("jobOperationBatch")
      .select("status")
      .eq("id", jobOperationBatchId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (batch.error || !batch.data) {
      log.warning("Could not read the operation's batch", {
        companyId,
        jobOperationBatchId,
        error: batch.error
      });
      return noBatchStatus("This operation's batch could not be checked");
    }
    return {
      refusal: floorRule({
        jobOperationBatchId,
        batchStatus: batch.data.status
      }),
      batchStatus: batch.data.status
    };
  }
  if (args.jobStatus !== undefined) {
    return noBatchStatus(
      floorRule({ jobOperationBatchId, jobStatus: args.jobStatus })
    );
  }
  const job = await client
    .from("job")
    .select("status")
    .eq("id", args.jobId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (job.error) {
    log.warning("Could not read the operation's job", {
      companyId,
      jobId: args.jobId,
      error: job.error
    });
    return noBatchStatus("This operation's job could not be checked");
  }
  return noBatchStatus(
    floorRule({ jobOperationBatchId, jobStatus: job.data?.status })
  );
}

/**
 * Whether a timer may run on `workCenterId`: the operation's own work center,
 * or one that runs its process (`workCenterProcess`, the rule the schedule
 * board applies when it moves an operation). The refusal text, or null.
 */
export async function workCenterRefusal(
  client: Client,
  args: {
    companyId: string;
    workCenterId: string;
    operation: { workCenterId: string | null; processId: string | null };
  }
): Promise<string | null> {
  const { companyId, workCenterId, operation } = args;
  if (workCenterId === operation.workCenterId) return null;
  const refusal = "This work center does not run this operation's process";
  if (!operation.processId) return refusal;
  const runs = await client
    .from("workCenterProcess")
    .select("workCenterId")
    .eq("workCenterId", workCenterId)
    .eq("processId", operation.processId)
    .eq("companyId", companyId)
    .limit(1);
  if (runs.error) {
    log.warning("Could not read the work center's processes", {
      companyId,
      workCenterId,
      error: runs.error
    });
    return "This work center could not be checked";
  }
  return runs.data.length > 0 ? null : refusal;
}

export type MaintenanceBlock = { dispatchReadableId: string | null };

/**
 * The open maintenance dispatch that blocks a work center, or null when the
 * work center is free. A failed read is free: the dispatch board is the
 * primary control, this a backstop that must not stop the floor.
 */
export async function maintenanceBlock(
  client: Client,
  args: { companyId: string; workCenterId: string }
): Promise<MaintenanceBlock | null> {
  const workCenter = await client
    .from("workCentersWithBlockingStatus")
    .select("isBlocked, blockingDispatchReadableId")
    .eq("id", args.workCenterId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (workCenter.error) {
    log.warning("Could not read the work center's maintenance block", {
      companyId: args.companyId,
      workCenterId: args.workCenterId,
      error: workCenter.error
    });
    return null;
  }
  return workCenter.data?.isBlocked
    ? { dispatchReadableId: workCenter.data.blockingDispatchReadableId }
    : null;
}

/** The refusal text for a blocked work center. */
export function maintenanceRefusal(block: MaintenanceBlock): string {
  return block.dispatchReadableId
    ? `Work center is blocked for maintenance (${block.dispatchReadableId})`
    : "Work center is blocked for maintenance";
}
