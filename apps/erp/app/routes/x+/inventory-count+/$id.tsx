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

  return {
    inventoryCount: inventoryCount.data,
    lines: lines.data ?? [],
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
