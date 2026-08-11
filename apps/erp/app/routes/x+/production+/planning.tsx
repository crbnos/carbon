import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ResizablePanel, ResizablePanelGroup, VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { ProductionPlanningItem } from "~/modules/production";
import { getProductionPlanning } from "~/modules/production";
import ProductionPlanningTable from "~/modules/production/ui/Planning/ProductionPlanningTable";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const WEEKS_TO_PLAN = 12 * 4;

export const handle: Handle = {
  breadcrumb: msg`Planning`,
  to: path.to.productionPlanning
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.inventory
  });

  const locationToday = datetime.today(
    await getLocationTimeZone(client, locationId, companyId)
  );
  const periods = await getOrCreatePeriods(locationToday, WEEKS_TO_PLAN);

  const items = await getProductionPlanning(
    client,
    locationId,
    companyId,
    periods.map((p) => p.id),
    {
      search,
      limit,
      offset,
      sorts,
      filters
    }
  );

  if (items.error) {
    redirect(
      path.to.production,
      await flash(request, error(items.error, "Failed to fetch planning items"))
    );
  }

  return {
    items: (items.data ?? []) as ProductionPlanningItem[],
    count: items.count ?? 0,
    periods,
    locationId,
    // Planned-order date defaults are business dates on the plant's calendar —
    // the drawer must not seed them from the planner's browser zone.
    locationToday: locationToday.toString()
  };
}

export default function ProductionPlanningRoute() {
  const { items, count, locationId, periods } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          defaultSize={50}
          maxSize={70}
          minSize={25}
          className="bg-background"
        >
          <ProductionPlanningTable
            data={items}
            count={count}
            locationId={locationId}
            periods={periods}
          />
        </ResizablePanel>
        <Outlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
