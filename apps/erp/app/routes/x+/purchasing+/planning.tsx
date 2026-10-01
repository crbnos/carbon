// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ResizablePanel, ResizablePanelGroup, VStack } from "@carbon/react";
import { datetime, isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getPlanningActions,
  PLANNING_ACTIONS_SCOPE_PARAM,
  resolvePlanningActionScope
} from "~/modules/production";
import type { PurchasingPlanningItem } from "~/modules/purchasing";
import { getPurchasingPlanning } from "~/modules/purchasing";
import PurchasingPlanningTable from "~/modules/purchasing/ui/Planning/PurchasingPlanningTable";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const WEEKS_TO_PLAN = 12 * 4;

export const handle: Handle = {
  breadcrumb: msg`Material Planning`,
  to: path.to.purchasingPlanning
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing",
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
    onDefaultsError: path.to.inventory,
    onNoLocations: path.to.purchasing
  });

  const locationToday = datetime.today(
    await getLocationTimeZone(client, locationId, companyId)
  );
  const periods = await getOrCreatePeriods(locationToday, WEEKS_TO_PLAN);

  // The grid's Actions-column filter and "Assigned to me" scope are not RPC
  // columns: they go to the RPC as arguments, which keeps the items with a
  // matching OPEN action inside each item's planning horizon.
  const { gridFilters, actionTypes, actionAssignee } =
    resolvePlanningActionScope({
      filters,
      scope: searchParams.get(PLANNING_ACTIONS_SCOPE_PARAM),
      userId
    });

  const items = await getPurchasingPlanning(
    client,
    locationId,
    companyId,
    periods.map((p) => p.id),
    {
      search,
      limit,
      offset,
      sorts,
      filters: gridFilters,
      asOf: locationToday.toString(),
      actionTypes,
      actionAssignee
    }
  );

  if (items.error) {
    redirect(
      path.to.purchasing,
      await flash(request, error(items.error, "Failed to fetch planning items"))
    );
  }

  // The persisted MRP action worklist for the rows on THIS page. Every action
  // is loaded, whatever its date: the grid hides the ones beyond each row's
  // time fence, and a planner can widen one row's fence without a reload.
  const planningActions = await getPlanningActions(client, {
    companyId,
    locationId,
    kind: "Buy",
    itemIds: (items.data ?? []).map((item) => item.id)
  });

  return {
    items: (items.data ?? []) as PurchasingPlanningItem[],
    count: items.count ?? 0,
    planningActions: planningActions.data ?? [],
    periods,
    locationId,
    // Planned-order date defaults are business dates on the plant's calendar —
    // the drawer must not seed them from the planner's browser zone.
    locationToday: locationToday.toString()
  };
}

export default function PurchasingPlanningRoute() {
  const { items, count, locationId, periods, planningActions, locationToday } =
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
          <PurchasingPlanningTable
            data={items}
            count={count}
            locationId={locationId}
            periods={periods}
            planningActions={planningActions}
            locationToday={locationToday}
          />
        </ResizablePanel>
        <Outlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
