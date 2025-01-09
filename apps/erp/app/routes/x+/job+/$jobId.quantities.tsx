import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { usePanels } from "~/components/Layout";
import {
  getJobOperationsList,
  getProductionQuantities,
  getScrapReasons,
} from "~/modules/production";
import { ProductionQuantitiesTable } from "~/modules/production/ui/Jobs";
import { path, requestReferrer } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const operations = await getJobOperationsList(client, jobId);
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
    return json({
      count: 0,
      events: [],
      operations: [],
      scrapReasons: [],
    });
  }

  const [events, scrapReasons] = await Promise.all([
    getProductionQuantities(client, operations.data?.map((o) => o.id) ?? [], {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getScrapReasons(client, companyId),
  ]);

  if (events.error) {
    redirect(
      path.to.production,
      await flash(request, error(events.error, "Failed to fetch job events"))
    );
  }

  return json({
    count: events.count ?? 0,
    events: events.data ?? [],
    operations: operations.data ?? [],
    scrapReasons: scrapReasons.data ?? [],
  });
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
      <VStack spacing={0} className="h-[calc(100dvh-99px)]">
        <ProductionQuantitiesTable
          data={events}
          count={count}
          operations={operations}
          scrapReasons={scrapReasons}
        />
      </VStack>
      <Outlet />
    </>
  );
}
