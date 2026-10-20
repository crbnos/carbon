// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getStockTransfers,
  STOCK_TRANSFERS_PAGING
} from "~/modules/inventory/inventory.service";
import StockTransfersTable from "~/modules/inventory/ui/StockTransfers/StockTransfersTable";
import { getLocationsList } from "~/modules/resources/resources.service";
import { getUserDefaults } from "~/modules/users/users.service";
import { toPage } from "~/utils/cursor";
import type { Handle } from "~/utils/handle";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "stock-transfers");

export const handle: Handle = {
  realtime: ["stockTransfer"],
  breadcrumb: msg`Stock Transfers`,
  to: path.to.stockTransfers
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, cursor, sorts, filters } =
    getGenericQueryFilters(searchParams);

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const stockTransfers = await getStockTransfers(client, companyId, {
    locationId,
    search,
    limit,
    cursor,
    sorts,
    filters
  });

  if (stockTransfers.error) {
    if (cursor) {
      logger.error("Failed to load a later page of stock transfers", {
        companyId,
        error: stockTransfers.error
      });
      return listErrorPage("stockTransfers");
    }
    logger.error(stockTransfers.error);
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading stock transfers"))
    );
  }

  const page = toPage(
    stockTransfers.data ?? [],
    { limit, sorts },
    STOCK_TRANSFERS_PAGING
  );

  return {
    stockTransfers: page.rows,
    count: stockTransfers.count ?? 0,
    nextCursor: page.nextCursor,
    locationId
  };
}

export default function StockTransfersRoute() {
  const { stockTransfers, count, nextCursor, locationId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <StockTransfersTable
        data={stockTransfers}
        count={count}
        nextCursor={nextCursor}
        locationId={locationId}
      />
      <RecordOutlet />
    </VStack>
  );
}
