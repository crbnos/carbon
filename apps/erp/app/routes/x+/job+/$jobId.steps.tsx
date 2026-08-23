import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import { getJobOperationStepRecords } from "~/modules/production";
import { JobOperationStepRecordsTable } from "~/modules/production/ui/Jobs";

import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
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

  const stepRecords = await getJobOperationStepRecords(client, jobId, {
    limit,
    offset,
    sorts,
    filters,
    search
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
    count: stepRecords.count ?? 0,
    stepRecords: stepRecords.data ?? []
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
      className="h-[calc(100dvh-var(--topbar-height)-var(--header-height))]"
    >
      {/* @ts-expect-error TS2322 */}
      <JobOperationStepRecordsTable data={stepRecords} count={count} />
    </VStack>
  );
}
