import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getJobReceivedTrackedEntityIds } from "~/modules/production";

/**
 * What a job has already received to inventory, read when the Complete dialog
 * opens so a receipt made while the job page was open is not missed. Uses the
 * service role: itemLedger is hidden from users without inventory or
 * accounting view, and the dialog would otherwise offer received units again.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "production",
    bypassRls: true
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const [job, receipts] = await Promise.all([
    client
      .from("job")
      .select("quantityReceivedToInventory")
      .eq("id", jobId)
      .eq("companyId", companyId)
      .maybeSingle(),
    getJobReceivedTrackedEntityIds(client, jobId, companyId)
  ]);

  if (job.error || receipts.error || !job.data) {
    return { receipts: null };
  }

  return {
    receipts: {
      quantityReceivedToInventory: job.data.quantityReceivedToInventory ?? 0,
      trackedEntityIds: (receipts.data ?? []).flatMap((receipt) =>
        receipt.trackedEntityId ? [receipt.trackedEntityId] : []
      )
    }
  };
}
