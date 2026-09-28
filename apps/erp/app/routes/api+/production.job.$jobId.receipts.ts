import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getJobReceiptSnapshot } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

/**
 * What a job has already received to inventory, read when the Complete dialog
 * opens so a receipt made while the job page was open is not missed. The
 * quantity and the received units come from one statement, so the dialog never
 * pairs values from different moments. Read past RLS: itemLedger is hidden from
 * users without inventory or accounting view, and the dialog would otherwise
 * offer received units again.
 *
 * A query failure throws rather than answering `null`: the dialog's fallback is
 * to lock the quantity, and a permanent failure that looks like a transient one
 * is the harder bug to find.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const job = await getJobReceiptSnapshot(
    getDatabaseClient(),
    jobId,
    companyId
  );
  if (!job) return { receipts: null };

  return {
    receipts: {
      quantityReceivedToInventory: job.quantityReceivedToInventory ?? 0,
      trackedEntityIds: job.trackedEntityIds
    }
  };
}
