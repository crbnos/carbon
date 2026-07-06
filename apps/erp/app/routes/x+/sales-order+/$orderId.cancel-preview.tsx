import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { LIVE_JOB_STATUSES } from "~/modules/sales";

export type CancelPreviewJob = {
  id: string;
  jobReadableId: string;
  itemReadableId: string | null;
  status: string;
  dueDate: string | null;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "sales"
  });

  const { orderId } = params;
  if (!orderId) {
    return { jobs: [] as CancelPreviewJob[] };
  }

  // Every live job created from this sales order — by lot-split or by line,
  // each is a top-level `job` row keyed by `salesOrderId`. Cancelling one
  // wipes out everything nested inside (its make-method tree is part of
  // the same job row), so no recursion is needed.
  const jobsResult = await client
    .from("job")
    .select("id, jobId, status, dueDate, itemId, item(readableId)")
    .eq("salesOrderId", orderId)
    .in("status", LIVE_JOB_STATUSES);

  const jobs: CancelPreviewJob[] = (jobsResult.data ?? []).map((j) => ({
    id: j.id,
    jobReadableId: j.jobId ?? "",
    itemReadableId:
      (j.item as { readableId?: string | null } | null)?.readableId ?? null,
    status: j.status ?? "",
    dueDate: j.dueDate ?? null
  }));

  return { jobs };
}
