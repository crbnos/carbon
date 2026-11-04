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
  getKanbanItems,
  getKanbanProjectedQuantities,
  KANBAN_ITEMS_PAGING
} from "~/modules/inventory/inventory.service";
import KanbansTable from "~/modules/inventory/ui/Kanbans/KanbansTable";
import { getLocationsList } from "~/modules/resources/resources.service";
import { getKanbanOutputSetting } from "~/modules/settings/settings.service";
import { getUserDefaults } from "~/modules/users/users.service";
import { toPage } from "~/utils/cursor";
import type { Handle } from "~/utils/handle";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "kanbans");

export const handle: Handle = {
  breadcrumb: msg`Kanbans`,
  to: path.to.kanbans,
  module: "inventory"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
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
        path.to.kanbans,
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
        path.to.kanbans,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const [result, kanbanOutput] = await Promise.all([
    getKanbanItems(client, locationId, companyId, {
      search,
      limit,
      cursor,
      sorts,
      filters
    }),
    getKanbanOutputSetting(client, companyId)
  ]);

  if (result.error) {
    if (cursor) {
      logger.error("Failed to load a later page of kanbans", {
        companyId,
        error: result.error
      });
      return listErrorPage("kanbanItems");
    }
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(result.error, "Failed to fetch kanbans"))
    );
  }

  const page = toPage(result.data, { limit, sorts }, KANBAN_ITEMS_PAGING);

  // One query for every armed Transfer kanban on the page. Each row carries
  // its own value, so every loaded page has it. A failure only hides the
  // projected quantity; the list still loads.
  const armedKanbanIds = page.rows.flatMap((item) =>
    item.kanbans
      .filter(
        (kanban) =>
          kanban.replenishmentSystem === "Transfer" &&
          kanban.replenishmentLevel !== null
      )
      .map((kanban) => kanban.id)
  );

  const projectedQuantities: Record<string, number> = {};
  if (armedKanbanIds.length > 0) {
    const projected = await getKanbanProjectedQuantities(
      client,
      companyId,
      armedKanbanIds
    );
    if (projected.error) {
      logger.error("Failed to load kanban projected quantities", {
        companyId,
        error: projected.error
      });
    } else {
      for (const row of projected.data ?? []) {
        projectedQuantities[row.kanbanId] = row.projectedQuantity;
      }
    }
  }

  return {
    count: result.count,
    kanbanItems: page.rows.map((item) => ({
      ...item,
      kanbans: item.kanbans.map((kanban) => ({
        ...kanban,
        projectedQuantity: projectedQuantities[kanban.id] ?? null
      }))
    })),
    nextCursor: page.nextCursor,
    kanbanOutput: kanbanOutput.data?.kanbanOutput ?? "qrcode",
    locationId
  };
}

export default function KanbansRoute() {
  const { count, kanbanItems, nextCursor, locationId, kanbanOutput } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <KanbansTable
        data={kanbanItems}
        count={count}
        nextCursor={nextCursor}
        locationId={locationId}
        kanbanOutput={kanbanOutput}
      />
      <RecordOutlet />
    </VStack>
  );
}
