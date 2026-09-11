import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getDemandForecastSources,
  getItemDemand,
  getItemQuantities,
  getItemSupply,
  getOpenJobMaterials,
  getOpenProductionOrders,
  getOpenPurchaseOrderLines,
  getOpenSalesOrderLines
} from "~/modules/items/items.service";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";

const defaultResponse = {
  demand: [],
  demandForecast: [],
  demandForecastSources: [],
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
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { id: itemId, locationId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!locationId) throw new Error("Could not find locationId");

  const periods = await getOrCreatePeriods(
    datetime.today(await getLocationTimeZone(client, locationId, companyId)),
    WEEKS_TO_FORECAST
  );

  const [
    demand,
    supply,
    quantities,
    openSalesOrderLines,
    openJobMaterials,
    openProductionOrders,
    openPurchaseOrderLines,
    demandForecastSources
  ] = await Promise.all([
    getItemDemand(client, {
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? ""),
      companyId
    }),
    getItemSupply(client, {
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? ""),
      companyId
    }),
    getItemQuantities(client, itemId, companyId, locationId),
    getOpenSalesOrderLines(client, { itemId, companyId, locationId }),
    getOpenJobMaterials(client, { itemId, companyId, locationId }),
    getOpenProductionOrders(client, { itemId, companyId, locationId }),
    getOpenPurchaseOrderLines(client, { itemId, companyId, locationId }),
    getDemandForecastSources(client, {
      itemId,
      locationId,
      periods: periods.map((p) => p.id ?? ""),
      companyId
    })
  ]);

  // Merge planner-authored projections (net of MRP forecast consumption) into
  // the forecast series. The planning RPCs' demand_data counts
  // actual + forecast + GREATEST(forecastQuantity - consumedQuantity, 0) per
  // projection; without this arm an item whose only demand is a
  // demandProjection charts zero demand here while the planning grid shows it.
  // The chart assigns (not accumulates) one "Demand Forecast" bucket per
  // period, so the merge keeps at most one forecast row per period.
  const netProjectionByPeriod = new Map<string, number>();
  for (const projection of demand.projections) {
    const net = Math.max(
      (projection.forecastQuantity ?? 0) - (projection.consumedQuantity ?? 0),
      0
    );
    if (net > 0) {
      netProjectionByPeriod.set(
        projection.periodId,
        (netProjectionByPeriod.get(projection.periodId) ?? 0) + net
      );
    }
  }

  const mergedPeriodIds = new Set<string>();
  const demandForecast = demand.forecasts.map((forecast) => {
    const net = netProjectionByPeriod.get(forecast.periodId);
    if (!net || mergedPeriodIds.has(forecast.periodId)) return forecast;
    mergedPeriodIds.add(forecast.periodId);
    return {
      ...forecast,
      forecastQuantity: (forecast.forecastQuantity ?? 0) + net
    };
  });
  for (const projection of demand.projections) {
    const net = netProjectionByPeriod.get(projection.periodId);
    if (!net || mergedPeriodIds.has(projection.periodId)) continue;
    mergedPeriodIds.add(projection.periodId);
    const {
      id: _id,
      consumedQuantity: _consumedQuantity,
      ...forecastFields
    } = projection;
    demandForecast.push({ ...forecastFields, forecastQuantity: net });
  }

  if (demand.actuals.length === 0 && demandForecast.length === 0) {
    return data(
      defaultResponse,
      await flash(request, error(null, "Failed to load demand"))
    );
  }

  return {
    demand: demand.actuals,
    demandForecast,
    demandForecastSources: demandForecastSources.data ?? [],
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
