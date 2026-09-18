import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getJobs } from "~/modules/production";
import { JobsTable } from "~/modules/production/ui/Jobs";
import { getLocationsList } from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.jobs
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [jobs, locations, tags] = await Promise.all([
    getJobs(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getLocationsList(client, companyId),
    getTagsList(client, companyId, "job")
  ]);

  if (jobs.error) {
    redirect(
      path.to.production,
      await flash(request, error(jobs.error, "Failed to fetch jobs"))
    );
  }

  // Which of this page's jobs have an operation in a live (Active/Completing)
  // batch. The jobs view carries no batch column — batching is per-operation —
  // so one secondary lookup builds jobId -> batch readableIds for the badge.
  const jobIds = (jobs.data ?? []).map((j) => j.id!).filter(Boolean);
  const batchedOps =
    jobIds.length > 0
      ? await client
          .from("jobOperation")
          .select("jobId, jobOperationBatch(id, readableId, status)")
          .in("jobId", jobIds)
          .eq("companyId", companyId)
          .not("jobOperationBatchId", "is", null)
      : { data: [], error: null };
  const batchesByJobId: Record<string, string[]> = {};
  for (const op of batchedOps.data ?? []) {
    const batch = op.jobOperationBatch;
    if (!batch || (batch.status !== "Active" && batch.status !== "Completing"))
      continue;
    if (!op.jobId || !batch.readableId) continue;
    const list = (batchesByJobId[op.jobId] ??= []);
    if (!list.includes(batch.readableId)) list.push(batch.readableId);
  }

  return {
    count: jobs.count ?? 0,
    jobs: jobs.data ?? [],
    batchesByJobId,
    locations: locations.data ?? [],
    tags: tags.data ?? []
  };
}

export default function JobsRoute() {
  const { count, tags, jobs, batchesByJobId } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <JobsTable
        data={jobs}
        count={count}
        tags={tags}
        batchesByJobId={batchesByJobId}
      />
      <Outlet />
    </VStack>
  );
}
