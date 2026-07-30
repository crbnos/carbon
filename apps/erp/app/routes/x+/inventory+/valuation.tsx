import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getInventoryValuation,
  getInventoryValuationTieOut,
  InventoryValuationWorkbench
} from "~/modules/inventory";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Valuation`,
  to: path.to.inventoryValuation,
  module: "inventory"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const url = new URL(request.url);
  const asOfDate =
    url.searchParams.get("asOfDate") ?? new Date().toISOString().slice(0, 10);
  const groupBy: "location" | "item" =
    url.searchParams.get("groupBy") === "item" ? "item" : "location";
  const locationId = url.searchParams.get("locationId") || null;

  // The tie-out only means something when journals are being posted — skip it
  // entirely when accounting is disabled (tieOut: null hides the panel).
  const companySettings = await getCompanySettings(client, companyId);
  const accountingEnabled =
    (companySettings.data as { accountingEnabled?: boolean } | null)
      ?.accountingEnabled ?? false;

  const [valuation, tieOut, locations] = await Promise.all([
    getInventoryValuation(client, companyId, { asOfDate, locationId }),
    accountingEnabled
      ? getInventoryValuationTieOut(client, companyId, asOfDate)
      : Promise.resolve({ data: null, error: null }),
    client
      .from("location")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name")
  ]);

  // A failed valuation query must surface, not render as an empty report.
  if (valuation.error) {
    throw new Error(valuation.error.message);
  }

  return {
    asOfDate,
    groupBy,
    locationId,
    rows: valuation.data ?? [],
    tieOut: tieOut.data ?? null,
    // A failed tie-out must read as "unavailable", not "nothing to tie out" —
    // this is a financial control surface.
    tieOutError: Boolean(tieOut.error),
    locations: locations.data ?? []
  };
}

export default function InventoryValuationRoute() {
  const {
    asOfDate,
    groupBy,
    locationId,
    rows,
    tieOut,
    tieOutError,
    locations
  } = useLoaderData<typeof loader>();
  return (
    <InventoryValuationWorkbench
      rows={rows}
      tieOut={tieOut}
      tieOutError={tieOutError}
      asOfDate={asOfDate}
      groupBy={groupBy}
      locationId={locationId}
      locations={locations}
    />
  );
}
