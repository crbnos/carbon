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
import {
  getPlanningActions,
  PLANNING_DRAWER_PARAM,
  resolvePlanningActionScope,
  resolvePlanningSegmentScope
} from "~/modules/production";
import { PlanningOverdueBorrows } from "~/modules/production/ui/Planning/PlanningOverdueBorrows";
import { getProjectBorrows } from "~/modules/projects";
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

const logger = getLogger("erp", "purchasing", "planning");

export const handle: Handle = {
  breadcrumb: msg`Material Planning`,
  to: path.to.purchasingPlanning
};

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

  // The grid's Actions and Assignee filters are not RPC
  // columns: they go to the RPC as arguments, which keeps the items with a
  // matching OPEN action inside each item's planning horizon.
  const actionScope = resolvePlanningActionScope({ filters });
  const { actionTypes, actionAssignees } = actionScope;
  // The Segment filter is not an RPC column either: Common is the empty
  // segment id, which a URL filter cannot carry.
  const { gridFilters, segments } = resolvePlanningSegmentScope({
    filters: actionScope.gridFilters
  });

  const periodIds = periods.map((p) => p.id);
  const asOf = locationToday.toString();

  // A link to a row's order drawer (`?item=`) opens it even when the row is
  // not on this page — the plan has changed since the link was made, or it
  // came from another page. That row is read on its own, alongside the page.
  const drawerItemId = searchParams.get(PLANNING_DRAWER_PARAM);

  const [items, drawerItemRead] = await Promise.all([
    getPurchasingPlanning(client, locationId, companyId, periodIds, {
      search,
      limit,
      offset,
      sorts,
      filters: gridFilters,
      asOf,
      actionTypes,
      actionAssignees,
      segments
    }),
    drawerItemId
      ? getPurchasingPlanning(client, locationId, companyId, periodIds, {
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
      path.to.purchasing,
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
  const pageItems = (items.data ?? []) as PurchasingPlanningItem[];
  const linkedItem = (drawerItemRead?.data?.[0] ??
    null) as PurchasingPlanningItem | null;
  const drawerItem =
    linkedItem && !pageItems.some((item) => item.id === linkedItem.id)
      ? linkedItem
      : null;

  // The persisted MRP action worklist for the rows on THIS page (and the
  // drawer's row). Every action is loaded, whatever its date: the grid hides
  // the ones beyond each row's time fence, and a planner can widen one row's
  // fence without a reload.
  // The projects that are netting segments (a project with project stock),
  // for the Segment column's names and its filter. One read of a bounded set.
  const segmentProjectsRead = client
    .from("project")
    .select("id, identifier, name")
    .eq("companyId", companyId)
    .eq("projectStock", true)
    .eq("projectType", "Standard")
    .order("identifier");

  const planningActions = await getPlanningActions(client, {
    companyId,
    locationId,
    kind: "Buy",
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

  // Open borrows at the location past their payback date: the worklist's
  // read-only Overdue borrows group, under the Segment filter (a borrow is in
  // the segments of its borrower and its lender; common holds none).
  const [segmentProjects, overdueBorrowsRead] = await Promise.all([
    segmentProjectsRead,
    getProjectBorrows(client, companyId, {
      status: ["Open"],
      locationId,
      dueBefore: asOf
    })
  ]);
  if (overdueBorrowsRead.error) {
    logger.error("Failed to load overdue project borrows", {
      companyId,
      locationId,
      error: overdueBorrowsRead.error
    });
  }
  const overdueBorrows = (overdueBorrowsRead.data ?? []).filter(
    (borrow) =>
      !segments ||
      segments.includes(borrow.borrowerProjectId) ||
      segments.includes(borrow.lenderProjectId)
  );
  if (segmentProjects.error) {
    logger.error("Failed to load the planning segment projects", {
      companyId,
      error: segmentProjects.error
    });
    throw new Response("Failed to load planning segments", { status: 500 });
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
    // The projects that net in their own segment ('' is common).
    segmentProjects: segmentProjects.data ?? [],
    overdueBorrows,
    periods,
    locationId,
    // Planned-order date defaults are business dates on the plant's calendar —
    // the drawer must not seed them from the planner's browser zone.
    locationToday: locationToday.toString()
  };
}

export default function PurchasingPlanningRoute() {
  const {
    items,
    drawerItem,
    count,
    locationId,
    periods,
    planningActions,
    actionTypes,
    segmentProjects,
    overdueBorrows,
    locationToday
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          defaultSize={50}
          maxSize={70}
          minSize={25}
          className="bg-background"
        >
          <div className="flex h-full flex-col">
            <PlanningOverdueBorrows borrows={overdueBorrows} />
            <div className="min-h-0 flex-1">
              <PurchasingPlanningTable
                data={items}
                drawerItem={drawerItem}
                count={count}
                locationId={locationId}
                periods={periods}
                planningActions={planningActions}
                actionTypes={actionTypes}
                segmentProjects={segmentProjects}
                locationToday={locationToday}
              />
            </div>
          </div>
        </ResizablePanel>
        <RecordOutlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
