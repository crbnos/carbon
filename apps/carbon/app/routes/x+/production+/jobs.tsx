import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { JobsTable, getJobs } from "~/modules/production";
import { getLocationsList } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [jobs, locations] = await Promise.all([
    getJobs(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getLocationsList(client, companyId),
  ]);

  if (jobs.error) {
    redirect(
      path.to.production,
      await flash(request, error(jobs.error, "Failed to fetch jobs"))
    );
  }

  return json({
    count: jobs.count ?? 0,
    jobs: jobs.data ?? [],
    locations: locations.data ?? [],
  });
}

export default function JobsRoute() {
  const { count, locations, jobs } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <JobsTable data={jobs} count={count} locations={locations} />
      <Outlet />
    </VStack>
  );
}
