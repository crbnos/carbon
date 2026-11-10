// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import ServiceJobsTable from "~/modules/service/ui/ServiceJob/ServiceJobsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.serviceJobs
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "service.jobs": "View" });

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const jobs = await api.service.getServiceJobs({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (jobs.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(jobs.error, "Failed to load service jobs"))
    );
  }

  return {
    jobs: jobs.data?.rows ?? [],
    count: jobs.data?.count ?? 0
  };
}

export default function ServiceJobsRoute() {
  const { jobs, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ServiceJobsTable data={jobs} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
