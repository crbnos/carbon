// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  RecordOutlet,
  ResizablePanel,
  ResizablePanelGroup,
  VStack
} from "@carbon/react";
import { datetime, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { ProductionPlanningItem } from "~/modules/production";
import {
  getPlanningActions,
  getProductionPlanning,
  PLANNING_DRAWER_PARAM,
  resolvePlanningActionScope
} from "~/modules/production";
import ProductionPlanningTable from "~/modules/production/ui/Planning/ProductionPlanningTable";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const WEEKS_TO_PLAN = 12 * 4;

const logger = getLogger("erp", "production", "planning");

export const handle: Handle = {
  appBarSubtitle: msg`Production`,
  realtime: ["job"],
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

  // The grid's Actions and Assignee filters are not RPC
  // columns: they go to the RPC as arguments, which keeps the items with a
  // matching OPEN action inside each item's planning horizon.
  const { gridFilters, actionTypes, actionAssignees } =
    resolvePlanningActionScope({ filters });

  const periodIds = periods.map((p) => p.id);
  const asOf = locationToday.toString();

  // A link to a row's order drawer (`?item=`) opens it even when the row is
  // not on this page — the plan has changed since the link was made, or it
  // came from another page. That row is read on its own, alongside the page.
  const drawerItemId = searchParams.get(PLANNING_DRAWER_PARAM);

  const [items, drawerItemRead] = await Promise.all([
    getProductionPlanning(client, locationId, companyId, periodIds, {
      search,
      limit,
      offset,
      sorts,
      filters: gridFilters,
      asOf,
      actionTypes,
      actionAssignees
    }),
    drawerItemId
      ? getProductionPlanning(client, locationId, companyId, periodIds, {
          search: null,
          limit: 1,
          offset: 0,
          sorts: [],
          filters: [{ column: "id", operator: "eq", value: drawerItemId }],
          asOf
        })
      : null
  ]);

  if (items.error) {
    redirect(
      path.to.production,
      await flash(request, error(items.error, "Failed to fetch planning items"))
    );
  }

  // A failed read of the linked row only leaves its drawer closed: the grid
  // drops a link it cannot resolve.
  if (drawerItemRead?.error) {
    logger.error("Failed to load the linked planning item", {
      companyId,
      locationId,
      itemId: drawerItemId,
      error: drawerItemRead.error
    });
  }
  const pageItems = (items.data ?? []) as ProductionPlanningItem[];
  const linkedItem = (drawerItemRead?.data?.[0] ??
    null) as ProductionPlanningItem | null;
  const drawerItem =
    linkedItem && !pageItems.some((item) => item.id === linkedItem.id)
      ? linkedItem
      : null;

  // The persisted MRP action worklist for the rows on THIS page (and the
  // drawer's row). Every action is loaded, whatever its date: the grid hides
  // the ones beyond each row's time fence, and a planner can widen one row's
  // fence without a reload.
  const planningActions = await getPlanningActions(client, {
    companyId,
    locationId,
    kind: "Make",
    itemIds: [...pageItems, ...(drawerItem ? [drawerItem] : [])].map(
      (item) => item.id
    )
  });

  // No fallback to an empty list: a grid with no actions reads as "nothing to
  // do", which is the one thing a failed read must not look like.
  if (planningActions.error) {
    logger.error("Failed to load planning actions", {
      companyId,
      locationId,
      error: planningActions.error
    });
    throw new Response("Failed to load planning actions", { status: 500 });
  }

  return {
    items: pageItems,
    // The row a `?item=` link opens the drawer on, when it is not in `items`.
    drawerItem,
    count: items.count ?? 0,
    planningActions: planningActions.data ?? [],
    // The Actions-column filter the rows were matched on: each row shows only
    // its actions of these types.
    actionTypes: actionTypes ?? null,
    periods,
    locationId,
    // Planned-order date defaults are business dates on the plant's calendar —
    // the drawer must not seed them from the planner's browser zone.
    locationToday: locationToday.toString()
  };
}

export default function ProductionPlanningRoute() {
  const {
    items,
    drawerItem,
    count,
    locationId,
    periods,
    planningActions,
    actionTypes,
    locationToday
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal" stackOnCompact>
        <ResizablePanel
          defaultSize={50}
          maxSize={70}
          minSize={25}
          className="bg-background"
        >
          <ProductionPlanningTable
            data={items}
            drawerItem={drawerItem}
            count={count}
            locationId={locationId}
            periods={periods}
            planningActions={planningActions}
            actionTypes={actionTypes}
            locationToday={locationToday}
          />
        </ResizablePanel>
        <RecordOutlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
