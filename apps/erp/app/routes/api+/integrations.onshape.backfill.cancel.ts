import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations-onshape-backfill-cancel");

// POST: cancel an in-flight Onshape backfill. Same gate as starting one — an
// admin who can start a sync can stop it.
//
// The route's own write IS the record of the cancellation: the cancelled state
// (and who cancelled) lands first, and only then is the cancel event fired. The
// killed run performs no cleanup of its own, so firing first would risk a run
// that is dead with nothing saying why.
export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const runId = formData.get("runId");

  if (typeof runId !== "string" || runId.length === 0) {
    return data({ error: "A sync run is required" }, { status: 400 });
  }

  // Service role: `onshapeSyncRun` is written only by routes and jobs, so it has
  // no UPDATE policy. The status filter makes this the transition guard — an
  // already-terminal run matches nothing and stays as it was.
  const now = new Date().toISOString();
  const cancelled = await getCarbonServiceRole()
    .from("onshapeSyncRun")
    .update({
      status: "cancelled",
      cancelledBy: userId,
      finishedAt: now,
      updatedBy: userId,
      updatedAt: now
    })
    .eq("id", runId)
    .eq("companyId", companyId)
    .in("status", ["queued", "running"])
    .select("id");

  if (cancelled.error) {
    logger.error("Failed to cancel Onshape sync run", {
      error: cancelled.error
    });
    return data({ error: "Failed to cancel the sync" }, { status: 500 });
  }

  if (cancelled.data.length === 0) {
    return data(
      { error: "Sync run not found or no longer running." },
      { status: 409 }
    );
  }

  try {
    await trigger("onshape-backfill-cancel", { companyId, runId });
  } catch (triggerError) {
    // The cancellation is already recorded; a missed event only means the run
    // keeps burning until it finishes and finds itself unable to claim a
    // terminal state.
    logger.error("Failed to signal Onshape backfill cancel", {
      error: triggerError
    });
  }

  return data({ success: true, message: "Onshape asset backfill cancelled" });
}
