import { requirePermissions } from "@carbon/auth/auth.server";
import { isInternalEmail } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getCompanyRestoreRuns } from "~/modules/settings";

// Polled by the restore progress modal. A restore run is "running" until its
// marker row appears (the job writes it once the wipe+load commits), then
// "ready" for keep/revert. Once kept or reverted the marker is gone again — the
// client knows which phase it's in, so it interprets absence accordingly.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  if (!isInternalEmail(email)) throw new Response("Not found", { status: 404 });
  const restoreRunId = params.restoreRunId;

  const runs = await getCompanyRestoreRuns(client, companyId);
  const run = runs.data?.find((r) => r.restoreRunId === restoreRunId);

  // No marker → "gone". The client interprets it by phase: during a restore it
  // means the job hasn't written its first heartbeat yet (transient); during a
  // revert it means the revert finished (the marker is deleted on success).
  return {
    status: run?.status ?? ("gone" as const),
    rows: run?.rows ?? 0,
    error: run?.error ?? null
  };
}
