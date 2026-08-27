import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations-onshape-backfill");

// Newest runs kept per company; older rows are pruned as each new run starts.
const RUN_RETENTION_COUNT = 50;

// Postgres unique_violation, raised by "onshapeSyncRun_oneLivePerCompany_idx".
const UNIQUE_VIOLATION = "23505";

const SYNC_ALREADY_LIVE =
  "A sync is already queued or running — cancel it before starting a new one.";

// POST: kick off the Onshape released-asset backfill for the current company.
// Admin-only. Gated on the SAME configurable flag the job checks
// (companyIntegration.metadata.assetSyncEnabled) so it can't be run unless the
// company has turned Onshape asset sync on.
//
// The run row is the record of the backfill: this route inserts it as `queued`
// and the job reports progress and its terminal state into it. Only an explicit
// terminal state (`completed`/`failed`/`cancelled`) releases the start guard —
// a run that looks stalled is a dashboard warning, never an unblock, so a wedged
// run has to be cancelled before another can start.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const integration = await client
    .from("companyIntegration")
    .select("active, metadata")
    .eq("companyId", companyId)
    .eq("id", "onshape")
    .single();

  if (integration.error || !integration.data?.active) {
    return data(
      { error: "Onshape integration not found or inactive" },
      { status: 400 }
    );
  }

  const metadata = (integration.data.metadata ?? {}) as Record<string, unknown>;
  if (metadata.assetSyncEnabled !== true) {
    return data(
      {
        error:
          "Onshape asset sync is disabled — enable it on the Onshape integration before running a backfill"
      },
      { status: 400 }
    );
  }

  // Service role throughout: `onshapeSyncRun` is written only by routes and jobs,
  // so it has no INSERT/UPDATE/DELETE policy. Every query filters companyId.
  const serviceRole = getCarbonServiceRole();

  const latestRun = await serviceRole
    .from("onshapeSyncRun")
    .select("id, status")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRun.error) {
    logger.error("Failed to read latest Onshape sync run", {
      error: latestRun.error
    });
    return data({ error: "Failed to start Onshape backfill" }, { status: 500 });
  }

  if (
    latestRun.data?.status === "queued" ||
    latestRun.data?.status === "running"
  ) {
    return data({ error: SYNC_ALREADY_LIVE }, { status: 409 });
  }

  const insertedRun = await serviceRole
    .from("onshapeSyncRun")
    .insert({ companyId, status: "queued", createdBy: userId })
    .select("id")
    .single();

  // The read above cannot rule out a start that lands between it and this
  // insert, so the one-live-run rule is enforced by a partial unique index and
  // the loser of the race reads as what it is: a sync is already live.
  if (insertedRun.error?.code === UNIQUE_VIOLATION) {
    return data({ error: SYNC_ALREADY_LIVE }, { status: 409 });
  }

  if (insertedRun.error || !insertedRun.data) {
    logger.error("Failed to create Onshape sync run", {
      error: insertedRun.error
    });
    return data({ error: "Failed to start Onshape backfill" }, { status: 500 });
  }

  const runId = insertedRun.data.id;

  // Retention: keep the newest RUN_RETENTION_COUNT rows for this company. The
  // boundary row's createdAt is the cut line, so one delete prunes everything
  // older regardless of how far behind retention the company has drifted.
  const retentionBoundary = await serviceRole
    .from("onshapeSyncRun")
    .select("createdAt")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    .range(RUN_RETENTION_COUNT - 1, RUN_RETENTION_COUNT - 1)
    .maybeSingle();

  if (retentionBoundary.error) {
    // Not fatal — the run is already queued and retention is housekeeping — but
    // an unreported failure here means pruning silently stops happening at all.
    logger.error("Failed to read the Onshape sync run retention boundary", {
      error: retentionBoundary.error
    });
  }

  if (retentionBoundary.data?.createdAt) {
    const pruned = await serviceRole
      .from("onshapeSyncRun")
      .delete()
      .eq("companyId", companyId)
      .lt("createdAt", retentionBoundary.data.createdAt);

    if (pruned.error) {
      logger.error("Failed to prune old Onshape sync runs", {
        error: pruned.error
      });
    }
  }

  try {
    await trigger("onshape-backfill", { companyId, userId, runId });
  } catch (triggerError) {
    logger.error("Failed to start Onshape backfill", { error: triggerError });
    // The job never got queued, so nothing else will ever move this row out of
    // `queued` — stamp it terminal here or the start guard stays shut forever.
    await serviceRole
      .from("onshapeSyncRun")
      .update({
        status: "failed",
        error: "Failed to queue the backfill job",
        finishedAt: new Date().toISOString(),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", runId)
      .eq("companyId", companyId);

    return data({ error: "Failed to start Onshape backfill" }, { status: 500 });
  }

  return data({
    success: true,
    runId,
    message: "Onshape asset backfill started"
  });
}
