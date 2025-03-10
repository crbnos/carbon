import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getTrackedEntities } from "~/modules/inventory";
import TrackedEntitiesTable from "~/modules/inventory/ui/Traceability/TrackedEntitiesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Tracked Entities",
  to: path.to.trackedEntities,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [trackedEntities] = await Promise.all([
    getTrackedEntities(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (trackedEntities.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(null, "Error loading tracked entities"))
    );
  }

  return json({
    trackedEntities: trackedEntities.data ?? [],
    count: trackedEntities.count ?? 0,
  });
}

export default function TraceabilityRoute() {
  const { trackedEntities, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrackedEntitiesTable data={trackedEntities ?? []} count={count ?? 0} />
    </VStack>
  );
}
