import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getItemDemand,
  getItemQuantities,
  getItemSupply,
  getOpenJobMaterials,
  getOpenProductionOrders,
  getOpenPurchaseOrderLines,
  getOpenSalesOrderLines
} from "~/modules/items/items.service.server";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";

const defaultResponse = {
  demand: [],
  demandForecast: [],
  supply: [],
  periods: [],
  quantityOnHand: 0,
  openSalesOrderLines: [],
  openJobMaterials: [],
  openProductionOrders: [],
  openPurchaseOrderLines: []
};

const WEEKS_TO_FORECAST = 12 * 4;

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });

  const { id: itemId, locationId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!locationId) throw new Error("Could not find locationId");

  const periods = await getOrCreatePeriods(
    today(getLocalTimeZone()),
    WEEKS_TO_FORECAST
  );

  const [
    demand,
    supply,
    quantities,
    openSalesOrderLines,
    openJobMaterials,
    openProductionOrders,
    openPurchaseOrderLines
  ] = await Promise.all([
    getItemDemand({
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? "")
    }),
    getItemSupply({
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? "")
    }),
    getItemQuantities(itemId, locationId),
    getOpenSalesOrderLines({ itemId, locationId }),
    getOpenJobMaterials({ itemId, locationId }),
    getOpenProductionOrders({ itemId, locationId }),
    getOpenPurchaseOrderLines({ itemId, locationId })
  ]);

  if (demand.actuals.length === 0 && demand.forecasts.length === 0) {
    return data(
      defaultResponse,
      await flash(request, error(null, "Failed to load demand"))
    );
  }

  return {
    demand: demand.actuals,
    demandForecast: demand.forecasts,
    supply: [
      ...supply.actuals,
      ...supply.forecasts.map((f) => ({
        ...f,
        actualQuantity: f.forecastQuantity
      }))
    ],
    periods,
    quantityOnHand: quantities.data?.quantityOnHand ?? 0,
    openSalesOrderLines: openSalesOrderLines.data ?? [],
    openJobMaterials: openJobMaterials.data ?? [],
    openProductionOrders: openProductionOrders.data ?? [],
    openPurchaseOrderLines: openPurchaseOrderLines.data ?? []
  };
}
