import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { pluckUnique } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getInventoryCount,
  getInventoryCountLineSummary,
  getInventoryCountLines,
  getInventoryCountMovements,
  getStorageTypesList,
  getStorageUnitsListForLocation,
  InventoryCountDetails
} from "~/modules/inventory";
import {
  getMaterialFormsList,
  getMaterialSubstancesList
} from "~/modules/items";
import { getTagsList } from "~/modules/shared";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Inventory Count`, to: path.to.inventoryCounts },
    (data) => data?.inventoryCount?.inventoryCountId
  )
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
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  // True blind counting: the system quantity (and the variance it can be
  // derived from) must not reach the client until the count is Posted. That
  // includes filtering on them — a crafted ?filter=systemQuantity:gt:0 would
  // reveal which lines have stock — so drop those filters while blind.
  const isBlindEntry =
    inventoryCount.data.isBlind && inventoryCount.data.status !== "Posted";
  const allowedFilters = isBlindEntry
    ? filters?.filter((f) => !["systemQuantity", "variance"].includes(f.column))
    : filters;

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
      offset,
      sorts,
      filters: allowedFilters
    }),
    getInventoryCountLineSummary(client, id, companyId),
    // Adjustments this count has posted (empty for a never-posted Draft).
    getInventoryCountMovements(client, companyId, id),
    // Option lists for the count-line column filters (same set the quantities
    // screen loads).
    getMaterialFormsList(client, companyId),
    getMaterialSubstancesList(client, companyId),
    getTagsList(client, companyId),
    getStorageTypesList(client, companyId),
    getStorageUnitsListForLocation(
      client,
      companyId,
      inventoryCount.data.locationId
    )
  ]);

  // Hiding the columns client-side isn't enough — the values would ship in the
  // loader payload and CSV export. Strip them server-side through Draft AND
  // Pending; they are revealed only once Posted.
  const lineData = (lines.data ?? []).map((line) =>
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
    summary,
    movements: movements.data ?? [],
    forms: forms.data ?? [],
    substances: substances.data ?? [],
    tags: pluckUnique(tags.data, (tag) => tag.name),
    storageTypes: storageTypes.data ?? [],
    storageUnits: storageUnits.data ?? []
  };
}

export default function InventoryCountDetailRoute() {
  const {
    inventoryCount,
    lines,
    count,
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
      <div className="flex flex-col h-[calc(100dvh-49px)] w-full overflow-hidden">
        <InventoryCountDetails
          inventoryCount={inventoryCount}
          lines={lines}
          count={count}
          summary={summary}
          movements={movements}
          forms={forms}
          substances={substances}
          tags={tags}
          storageTypes={storageTypes}
          storageUnits={storageUnits}
        />
      </div>
      <Outlet />
    </>
  );
}
