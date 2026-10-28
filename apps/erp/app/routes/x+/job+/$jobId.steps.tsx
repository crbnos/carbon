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
  getJobOperationStepRecords,
  JOB_OPERATION_STEP_RECORDS_PAGING
} from "~/modules/production/production.service";
import { JobOperationStepRecordsTable } from "~/modules/production/ui/Jobs";
import { toPage } from "~/utils/cursor";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "job-steps");

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

  const stepRecords = await getJobOperationStepRecords(
    client,
    jobId,
    companyId,
    {
      limit,
      cursor,
      sorts,
      filters,
      search
    }
  );

  if (stepRecords.error) {
    if (cursor) {
      logger.error("Failed to load a later page of job step records", {
        companyId,
        error: stepRecords.error
      });
      return listErrorPage("stepRecords");
    }
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(stepRecords.error, "Failed to fetch job operation step records")
      )
    );
  }

  const page = toPage(
    stepRecords.data ?? [],
    { limit, sorts },
    JOB_OPERATION_STEP_RECORDS_PAGING
  );

  return {
    count: stepRecords.count ?? 0,
    stepRecords: page.rows,
    nextCursor: page.nextCursor
  };
}

export default function JobOperationStepRecordsRoute() {
  const { count, stepRecords, nextCursor } = useLoaderData<typeof loader>();

  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))]"
    >
      <JobOperationStepRecordsTable
        // @ts-expect-error TS2322
        data={stepRecords}
        count={count}
        nextCursor={nextCursor}
      />
    </VStack>
  );
}
