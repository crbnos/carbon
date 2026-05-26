import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getJobs } from "~/modules/production/production.service.server";
import { JobsTable } from "~/modules/production/ui/Jobs";
import { getLocationsList } from "~/modules/resources/resources.service.server";
import { getTagsList } from "~/modules/shared/shared.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.jobs
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
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
    getJobs({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getLocationsList(),
    getTagsList("job")
  ]);

  if (jobs.error) {
    redirect(
      path.to.production,
      await flash(request, error(jobs.error, "Failed to fetch jobs"))
    );
  }

  return {
    count: jobs.count ?? 0,
    jobs: jobs.data ?? [],
    locations: locations.data ?? [],
    tags: tags.data ?? []
  };
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
