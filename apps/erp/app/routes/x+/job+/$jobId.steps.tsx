// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import { JobOperationStepRecordsTable } from "~/modules/production/ui/Jobs";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "production",
    role: "employee"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const stepRecords = await api.production.getJobOperationStepRecords({
    limit,
    offset,
    sorts,
    filters,
    search,
    jobId
  });

  if (stepRecords.error) {
    redirect(
      path.to.production,
      await flash(
        request,
        error(stepRecords.error, "Failed to fetch job operation step records")
      )
    );
  }

  return {
    count: stepRecords.data?.count ?? 0,
    stepRecords: stepRecords.data?.rows ?? []
  };
}

export default function JobOperationStepRecordsRoute() {
  const { count, stepRecords } = useLoaderData<typeof loader>();

  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))]"
    >
      {/* @ts-expect-error TS2322 */}
      <JobOperationStepRecordsTable data={stepRecords} count={count} />
    </VStack>
  );
}
