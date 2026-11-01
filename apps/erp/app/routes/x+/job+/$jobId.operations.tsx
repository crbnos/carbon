// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { useMount, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import {
  getJob,
  getJobOperations,
  JOB_OPERATIONS_PAGING
} from "~/modules/production/production.service";
import { JobOperationsTable } from "~/modules/production/ui/Jobs";
import { toPage } from "~/utils/cursor";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "job-operations");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, cursor, sorts, filters } =
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
    cursor,
    sorts,
    filters
  });

  if (operations.error) {
    if (cursor) {
      logger.error("Failed to load a later page of job operations", {
        companyId,
        error: operations.error
      });
      return listErrorPage("operations");
    }
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(operations.error, "Failed to fetch job operations")
      )
    );
  }

  const page = toPage(
    operations.data ?? [],
    { limit, sorts },
    JOB_OPERATIONS_PAGING
  );

  return {
    count: operations.count ?? 0,
    operations: page.rows,
    nextCursor: page.nextCursor
  };
}

export default function JobOperationsRoute() {
  const { count, operations, nextCursor } = useLoaderData<typeof loader>();

  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))]"
    >
      <JobOperationsTable
        data={operations}
        count={count}
        nextCursor={nextCursor}
      />
    </VStack>
  );
}
