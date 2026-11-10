// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, useMount, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import {
  getJobOperationsList,
  getProductionQuantities,
  getScrapReasons,
  PRODUCTION_QUANTITIES_PAGING
} from "~/modules/production/production.service";
import { ProductionQuantitiesTable } from "~/modules/production/ui/Jobs";
import { toPage } from "~/utils/cursor";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path, requestReferrer } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "job-quantities");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, cursor, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const operations = await getJobOperationsList(client, jobId);
  if (operations.error) {
    throw redirect(
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
      nextCursor: null,
      operations: [],
      scrapReasons: []
    };
  }

  // A later page (`?after=`) is read for its rows only: skip the scrap reasons.
  const [events, scrapReasons] = await Promise.all([
    getProductionQuantities(client, operations.data?.map((o) => o.id) ?? [], {
      search,
      limit,
      cursor,
      sorts,
      filters
    }),
    cursor ? null : getScrapReasons(client, companyId)
  ]);

  if (events.error) {
    if (cursor) {
      logger.error("Failed to load a later page of production quantities", {
        companyId,
        error: events.error
      });
      return listErrorPage("events");
    }
    throw redirect(
      path.to.production,
      await flash(request, error(events.error, "Failed to fetch job events"))
    );
  }

  const page = toPage(
    events.data ?? [],
    { limit, sorts },
    PRODUCTION_QUANTITIES_PAGING
  );

  return {
    count: events.count ?? 0,
    events: page.rows,
    nextCursor: page.nextCursor,
    operations: operations.data ?? [],
    scrapReasons: scrapReasons?.data ?? []
  };
}

export default function ProductionQuantitiesRoute() {
  const { count, events, nextCursor, operations, scrapReasons } =
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
          nextCursor={nextCursor}
          operations={operations}
          scrapReasons={scrapReasons}
        />
      </VStack>
      <RecordOutlet />
    </>
  );
}
