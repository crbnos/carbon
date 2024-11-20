import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getJob,
  getJobOperations,
  JobOperationsTable,
} from "~/modules/production";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
    role: "employee",
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const job = await getJob(client, jobId);
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  const operations = await getJobOperations(client, jobId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  if (operations.error) {
    redirect(
      path.to.production,
      await flash(
        request,
        error(operations.error, "Failed to fetch job operations")
      )
    );
  }

  // TODO: get item inventory

  return json({
    count: operations.count ?? 0,
    operations: operations.data ?? [],
  });
}

export default function JobOperationsRoute() {
  const { count, operations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-[calc(100dvh-99px)]">
      <JobOperationsTable data={operations} count={count} />
    </VStack>
  );
}
