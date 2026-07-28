import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getOpenSalesOrderLinesForItem } from "~/modules/sales";

// Sales order lines a job can be linked to: open/draft orders whose line item
// matches this job's item. Consumed by the JobSalesOrderLine picker.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) {
    return { data: [], error: null };
  }

  const job = await client
    .from("job")
    .select("itemId")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .single();

  if (job.error || !job.data?.itemId) {
    return { data: [], error: null };
  }

  const lines = await getOpenSalesOrderLinesForItem(
    client,
    companyId,
    job.data.itemId
  );

  if (lines.error) {
    return data(
      { data: [], error: lines.error },
      await flash(
        request,
        error(lines.error, "Failed to get sales order lines")
      )
    );
  }

  return lines;
}
