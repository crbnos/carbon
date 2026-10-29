// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { JobsTable } from "~/modules/production/ui/Jobs";
import { getLocationsList } from "~/modules/resources/resources.service";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { jobsList } from "~/utils/list-registry/production.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["job"],
  breadcrumb: msg`Jobs`,
  to: path.to.jobs
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, jobsList, {
    dataKey: "jobs",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => {
      const [locations, tags] = await Promise.all([
        getLocationsList(client, companyId),
        getTagsList(client, companyId, "job")
      ]);
      return { locations: locations.data ?? [], tags: tags.data ?? [] };
    },
    onError: { redirectTo: path.to.production, message: "Failed to fetch jobs" }
  });
}

export default function JobsRoute() {
  const { count, tags, jobs, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <JobsTable data={jobs} count={count} infinite={infinite} tags={tags} />
      <RecordOutlet />
    </VStack>
  );
}
