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
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  try {
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
  } catch {
    return { receipts: null };
  }
}
