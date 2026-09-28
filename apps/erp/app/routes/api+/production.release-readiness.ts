import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import type { JobReleaseReadiness } from "~/modules/production";
import { getJobReleaseReadiness } from "~/modules/production";

// What releasing a batch would release, and what stands in its way: the
// Draft/Planned jobs behind `?batchId=` (an existing batch) or `?jobId=`
// (the builder's selection, before the batch exists). Already-released jobs are
// left out — their outside operations were handled when they were released.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const url = new URL(request.url);
  const batchId = url.searchParams.get("batchId");
  let jobIds = url.searchParams.getAll("jobId");

  if (batchId) {
    const members = await client
      .from("jobOperation")
      .select("jobId")
      .eq("jobOperationBatchId", batchId)
      .eq("companyId", companyId);
    if (members.error) {
      return data(
        { error: "Failed to load the batch's jobs" },
        { status: 500 }
      );
    }
    jobIds = (members.data ?? []).map((m) => m.jobId);
  }

  const unreleased = jobIds.length
    ? await client
        .from("job")
        .select("id")
        .in("id", [...new Set(jobIds)])
        .in("status", ["Draft", "Planned"])
        .eq("companyId", companyId)
    : { data: [], error: null };
  if (unreleased.error) {
    return data({ error: "Failed to load the batch's jobs" }, { status: 500 });
  }

  const readiness = await getJobReleaseReadiness(
    client,
    (unreleased.data ?? []).map((job) => job.id),
    companyId
  );
  if (readiness.error || !readiness.data) {
    return data(
      { error: "Failed to validate the batch's jobs" },
      { status: 500 }
    );
  }
  return readiness.data satisfies JobReleaseReadiness;
}
