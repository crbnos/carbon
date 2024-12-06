import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getJobs } from "~/modules/production";
import { JobsTable } from "~/modules/production/ui/Jobs";
import { getLocationsList } from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
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

  const [jobs, locations, tags] = await Promise.all([
    getJobs(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getLocationsList(client, companyId),
    getTagsList(client, companyId, "job"),
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
    tags: tags.data ?? [],
  });
}

export default function JobsRoute() {
  const { count, tags, jobs } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <JobsTable data={jobs} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
