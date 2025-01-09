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
  getProductionEvents,
} from "~/modules/production";
import { ProductionEventsTable } from "~/modules/production/ui/Jobs";
import { getWorkCentersList } from "~/modules/resources";
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
      workCenters: [],
      operations: [],
    });
  }

  const [events, workCenters] = await Promise.all([
    getProductionEvents(client, operations.data?.map((o) => o.id) ?? [], {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getWorkCentersList(client, companyId),
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
    workCenters: workCenters.data ?? [],
    operations: operations.data ?? [],
  });
}

export default function ProductionEventsRoute() {
  const { count, events, operations, workCenters } =
    useLoaderData<typeof loader>();

  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <>
      <VStack spacing={0} className="h-[calc(100dvh-99px)]">
        <ProductionEventsTable
          data={events}
          count={count}
          operations={operations}
          workCenters={workCenters}
        />
      </VStack>
      <Outlet />
    </>
  );
}
