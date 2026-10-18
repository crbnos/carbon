// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, useMount, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import { ProductionQuantitiesTable } from "~/modules/production/ui/Jobs";
import { path, requestReferrer } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "production"
  });
  const api = carbonFor(auth);

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const operations = await api.production.getJobOperationsList({ jobId });
  if (operations.error) {
    redirect(
      requestReferrer(request) ?? path.to.job(jobId),
      await flash(
        request,
        error(operations.error, "Failed to fetch job operations")
      )
    );
  }

  if (operations.data?.length === 0) {
    return {
      count: 0,
      events: [],
      operations: [],
      scrapReasons: []
    };
  }

  const [events, scrapReasons] = await Promise.all([
    api.production.getProductionQuantities({
      search,
      limit,
      offset,
      sorts,
      filters,
      jobOperationIds: operations.data?.map((o) => o.id) ?? []
    }),
    api.production.getScrapReasons({})
  ]);

  if (events.error) {
    redirect(
      path.to.production,
      await flash(request, error(events.error, "Failed to fetch job events"))
    );
  }

  return {
    count: events.data?.count ?? 0,
    events: events.data?.rows ?? [],
    operations: operations.data ?? [],
    scrapReasons: scrapReasons.data?.rows ?? []
  };
}

export default function ProductionQuantitiesRoute() {
  const { count, events, operations, scrapReasons } =
    useLoaderData<typeof loader>();

  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <>
      <VStack
        spacing={0}
        className="h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))]"
      >
        <ProductionQuantitiesTable
          data={events}
          count={count}
          operations={operations}
          scrapReasons={scrapReasons}
        />
      </VStack>
      <RecordOutlet />
    </>
  );
}
