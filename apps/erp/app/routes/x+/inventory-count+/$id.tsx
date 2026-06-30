import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getInventoryCount,
  getInventoryCountLineSummary,
  getInventoryCountLines,
  InventoryCountDetails
} from "~/modules/inventory";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Inventory Count`,
  to: path.to.inventoryCounts
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

  const [lines, summary] = await Promise.all([
    getInventoryCountLines(client, id, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getInventoryCountLineSummary(client, id, companyId)
  ]);

  // True blind counting: the system quantity (and the variance it can be derived
  // from) must not reach the client while the count is still being entered
  // (Draft). Hiding the columns client-side isn't enough — the values would ship
  // in the loader payload and CSV export. Strip them server-side; they are
  // revealed once the count is locked (Pending and later).
  const isBlindEntry =
    inventoryCount.data.isBlind && inventoryCount.data.status === "Draft";
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
    summary
  };
}

export default function InventoryCountDetailRoute() {
  const { inventoryCount, lines, count, summary } =
    useLoaderData<typeof loader>();

  return (
    <>
      <div className="flex flex-col h-[calc(100dvh-49px)] w-full overflow-hidden">
        <InventoryCountDetails
          inventoryCount={inventoryCount}
          lines={lines}
          count={count}
          summary={summary}
        />
      </div>
      <Outlet />
    </>
  );
}
