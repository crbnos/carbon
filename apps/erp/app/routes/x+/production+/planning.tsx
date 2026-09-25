import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ResizablePanel, ResizablePanelGroup, VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { ProductionPlanningItem } from "~/modules/production";
import {
  getPlanningActions,
  getProductionPlanning
} from "~/modules/production";
import PlanningActionsTable from "~/modules/production/ui/Planning/PlanningActionsTable";
import ProductionPlanningTable from "~/modules/production/ui/Planning/ProductionPlanningTable";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const WEEKS_TO_PLAN = 12 * 4;

export const handle: Handle = {
  breadcrumb: msg`Material Planning`,
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

  const [items, planningActions] = await Promise.all([
    getProductionPlanning(
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
    ),
    // the persisted MRP action worklist — deliberately NOT driven by the
    // grid's URL filters/sorts (those name grid columns)
    getPlanningActions(client, {
      companyId,
      locationId,
      kind: "Make",
      search: null,
      limit: 500,
      offset: 0
    })
  ]);

  if (items.error) {
    redirect(
      path.to.production,
      await flash(request, error(items.error, "Failed to fetch planning items"))
    );
  }

  return {
    items: (items.data ?? []) as ProductionPlanningItem[],
    count: items.count ?? 0,
    planningActions: planningActions.data ?? [],
    periods,
    locationId,
    // Planned-order date defaults are business dates on the plant's calendar —
    // the drawer must not seed them from the planner's browser zone.
    locationToday: locationToday.toString()
  };
}

export default function ProductionPlanningRoute() {
  const { items, count, locationId, periods, planningActions } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          defaultSize={50}
          maxSize={70}
          minSize={25}
          className="bg-background"
        >
          <div className="flex flex-col h-full">
            <PlanningActionsTable
              actions={planningActions}
              kind="Make"
              locationId={locationId}
              updatePath={path.to.bulkUpdateProductionPlanning}
            />
            <div className="flex-1 min-h-0">
              <ProductionPlanningTable
                data={items}
                count={count}
                locationId={locationId}
                periods={periods}
              />
            </div>
          </div>
        </ResizablePanel>
        <Outlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
