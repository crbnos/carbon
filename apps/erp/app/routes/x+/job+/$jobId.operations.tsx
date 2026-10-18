// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import { JobOperationsTable } from "~/modules/production/ui/Jobs";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });
  const api = carbonFor(auth);

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const job = await api.production.getJob({ id: jobId });
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  const operations = await api.production.getJobOperations({
    search,
    limit,
    offset,
    sorts,
    filters,
    jobId
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

  return {
    count: operations.data?.count ?? 0,
    operations: operations.data?.rows ?? []
  };
}

export default function JobOperationsRoute() {
  const { count, operations } = useLoaderData<typeof loader>();

  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))]"
    >
      <JobOperationsTable data={operations} count={count} />
    </VStack>
  );
}
