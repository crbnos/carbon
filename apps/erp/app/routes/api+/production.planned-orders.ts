// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  getDrawerPlannedOrders,
  getPlanningTimeFenceDays
} from "~/modules/production/production.utils";

const logger = getLogger("erp", "planned-orders");

const plannedOrdersQueryValidator = z.object({
  itemId: z.string().min(1),
  locationId: z.string().min(1),
  orderType: z.enum(["Make", "Buy"])
});

// The planning drawer's Planned Orders section: one item's Planned and Firm
// planned orders at one location, and the time fence that marks the held
// ones. Read as the caller, so RLS applies; a Make order needs View on
// production's Material Planning, a Buy order on purchasing's, the pages
// whose drawers show them.
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).searchParams;
  const parsed = plannedOrdersQueryValidator.safeParse({
    itemId: search.get("itemId"),
    locationId: search.get("locationId"),
    orderType: search.get("orderType")
  });
  if (!parsed.success) {
    logger.warning("Planned orders read refused: bad query", {
      issues: parsed.error.issues
    });
    throw data(
      { error: "itemId, locationId and orderType (Make or Buy) are required" },
      { status: 400 }
    );
  }
  const { itemId, locationId, orderType } = parsed.data;

  const { client, companyId } = await authorize(
    request,
    orderType === "Make"
      ? { "production.materialPlanning": "View" }
      : { "purchasing.materialPlanning": "View" }
  );

  const args = { companyId, itemId, locationId };
  const [orders, fence] = await Promise.all([
    getDrawerPlannedOrders(client, { ...args, orderType }),
    getPlanningTimeFenceDays(client, args)
  ]);
  if (orders.error) {
    logger.error("Failed to read the item's planned orders", {
      itemId,
      locationId,
      orderType,
      error: orders.error
    });
    throw data({ error: "Failed to load the planned orders" }, { status: 500 });
  }
  if (fence.error) {
    // A fence that cannot be read only hides the "Fence" marker.
    logger.warning("Failed to read the planning time fence", {
      itemId,
      locationId,
      error: fence.error
    });
  }

  return { orders: orders.data, fenceDays: fence.data ?? 0 };
}

export const clientLoader = cachedClientLoader<typeof loader>();
