// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import KanbansTable from "~/modules/inventory/ui/Kanbans/KanbansTable";
import { getUserDefaults } from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "kanbans");
export const handle: Handle = {
  breadcrumb: msg`Kanbans`,
  to: path.to.kanbans,
  module: "inventory"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, api } = await authorize(request, {
    view: "inventory",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
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
    const locations = await api.resources.getLocationsList({});
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

  const [kanbans, kanbanOutput] = await Promise.all([
    api.inventory.getKanbans({
      search,
      limit,
      offset,
      sorts,
      filters,
      locationId
    }),
    api.settings.getKanbanOutputSetting({})
  ]);

  if (kanbans.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(kanbans.error, "Failed to fetch kanbans"))
    );
  }

  // One query for every armed Transfer kanban on the page. A failure only
  // hides the Projected (To) column; the list still loads.
  const armedKanbanIds = (kanbans.data?.rows ?? [])
    .filter(
      (kanban) =>
        kanban.replenishmentSystem === "Transfer" &&
        kanban.replenishmentLevel !== null &&
        kanban.id
    )
    .map((kanban) => kanban.id!);

  const projectedQuantities: Record<string, number> = {};
  if (armedKanbanIds.length > 0) {
    const projected = await api.inventory.getKanbanProjectedQuantities({
      kanbanIds: armedKanbanIds
    });
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
    count: kanbans.data?.count ?? 0,
    kanbans: kanbans.data?.rows ?? [],
    kanbanOutput: kanbanOutput.data?.kanbanOutput ?? "qrcode",
    locationId,
    projectedQuantities
  };
}

export default function KanbansRoute() {
  const { count, kanbans, locationId, kanbanOutput, projectedQuantities } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <KanbansTable
        data={kanbans}
        count={count}
        locationId={locationId}
        kanbanOutput={kanbanOutput}
        projectedQuantities={projectedQuantities}
      />
      <RecordOutlet />
    </VStack>
  );
}
