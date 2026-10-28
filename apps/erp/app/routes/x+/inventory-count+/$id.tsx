// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { pluckUnique, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getInventoryCount,
  getInventoryCountLineSummary,
  getInventoryCountLines,
  getInventoryCountMovements,
  getStorageTypesList,
  getStorageUnitsListForLocation,
  INVENTORY_COUNT_LINES_PAGING
} from "~/modules/inventory/inventory.service";
import { InventoryCountDetails } from "~/modules/inventory/ui";
import {
  getMaterialFormsList,
  getMaterialSubstancesList
} from "~/modules/items/items.service";
import { getTagsList } from "~/modules/shared/shared.service";
import { toPage } from "~/utils/cursor";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "inventory-count");

export const handle: Handle = {
  realtime: [
    { table: "inventoryCount", column: "id", param: "id" },
    { table: "inventoryCountLine", column: "inventoryCountId", param: "id" }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Inventory Count`, to: path.to.inventoryCounts },
    (data) => data?.inventoryCount?.inventoryCountId
  ),
  module: "inventory"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const inventoryCount = await getInventoryCount(client, id, companyId);
  if (inventoryCount.error || !inventoryCount.data) {
    throw redirect(
      path.to.inventoryCounts,
      await flash(
        request,
        error(inventoryCount.error, "Failed to load inventory count")
      )
    );
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, cursor, sorts, filters } =
    getGenericQueryFilters(searchParams);
  // A later page (`?after=`) is read for its rows only: skip the summary,
  // the movements and the option lists.
  const isFirstPage = !cursor;

  // True blind counting: the system quantity (and the variance it can be
  // derived from) must not reach the client until the count is Posted. That
  // includes filtering on them — a crafted ?filter=systemQuantity:gt:0 would
  // reveal which lines have stock — so drop those filters while blind. The
  // same goes for sorts: the next-page cursor holds the last row's sort values.
  const isBlindEntry =
    inventoryCount.data.isBlind && inventoryCount.data.status !== "Posted";
  const isWithheld = (column: string) =>
    ["systemQuantity", "variance"].includes(column);
  const allowedFilters = isBlindEntry
    ? filters?.filter((f) => !isWithheld(f.column))
    : filters;
  const allowedSorts = isBlindEntry
    ? sorts?.filter((s) => !isWithheld(s.sortBy))
    : sorts;

  const [
    lines,
    summary,
    movements,
    forms,
    substances,
    tags,
    storageTypes,
    storageUnits
  ] = await Promise.all([
    getInventoryCountLines(client, id, companyId, {
      search,
      limit,
      cursor,
      sorts: allowedSorts,
      filters: allowedFilters
    }),
    isFirstPage ? getInventoryCountLineSummary(client, id, companyId) : null,
    // Adjustments this count has posted (empty for a never-posted Draft).
    isFirstPage ? getInventoryCountMovements(client, companyId, id) : null,
    // Option lists for the count-line column filters (same set the quantities
    // screen loads).
    isFirstPage ? getMaterialFormsList(client, companyId) : null,
    isFirstPage ? getMaterialSubstancesList(client, companyId) : null,
    isFirstPage ? getTagsList(client, companyId) : null,
    isFirstPage ? getStorageTypesList(client, companyId) : null,
    isFirstPage
      ? getStorageUnitsListForLocation(
          client,
          companyId,
          inventoryCount.data.locationId
        )
      : null
  ]);

  if (lines.error && cursor) {
    logger.error("Failed to load a later page of inventory count lines", {
      companyId,
      error: lines.error
    });
    return listErrorPage("lines");
  }

  const page = toPage(
    lines.data ?? [],
    { limit, sorts: allowedSorts },
    INVENTORY_COUNT_LINES_PAGING
  );

  // Hiding the columns client-side isn't enough — the values would ship in the
  // loader payload and CSV export. Strip them server-side through Draft AND
  // Pending; they are revealed only once Posted.
  const lineData = page.rows.map((line) =>
    isBlindEntry
      ? // Withhold System Qty (and the variance it can be derived from). Use null,
        // not 0, so it reads as "not available" (blank / "—" in the UI and CSV)
        // rather than a misleading real value.
        { ...line, systemQuantity: null as unknown as number, variance: null }
      : line
  );

  return {
    inventoryCount: inventoryCount.data,
    lines: lineData,
    count: lines.count ?? 0,
    nextCursor: page.nextCursor,
    summary: summary ?? { uncounted: 0, variances: 0 },
    movements: movements?.data ?? [],
    forms: forms?.data ?? [],
    substances: substances?.data ?? [],
    tags: pluckUnique(tags?.data, (tag) => tag.name),
    storageTypes: storageTypes?.data ?? [],
    storageUnits: storageUnits?.data ?? []
  };
}

export default function InventoryCountDetailRoute() {
  const {
    inventoryCount,
    lines,
    count,
    nextCursor,
    summary,
    movements,
    forms,
    substances,
    tags,
    storageTypes,
    storageUnits
  } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] w-full overflow-hidden">
        <InventoryCountDetails
          inventoryCount={inventoryCount}
          lines={lines}
          count={count}
          nextCursor={nextCursor}
          summary={summary}
          movements={movements}
          forms={forms}
          substances={substances}
          tags={tags}
          storageTypes={storageTypes}
          storageUnits={storageUnits}
        />
      </div>
      <RecordOutlet />
    </>
  );
}
