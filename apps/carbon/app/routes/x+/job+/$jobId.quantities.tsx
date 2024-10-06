import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getJobOperationsList,
  getJobQuantities,
  JobQuantitiesTable,
} from "~/modules/production";
import { getWorkCentersList } from "~/modules/resources";
import { path } from "~/utils/path";
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

  const [events, workCenters, operations] = await Promise.all([
    getJobQuantities(client, jobId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getWorkCentersList(client, companyId),
    getJobOperationsList(client, jobId),
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

export default function JobQuantitiesRoute() {
  const { count, events, operations, workCenters } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-[calc(100vh-99px)]">
      <JobQuantitiesTable
        data={events}
        count={count}
        operations={operations}
        workCenters={workCenters}
      />
    </VStack>
  );
}
