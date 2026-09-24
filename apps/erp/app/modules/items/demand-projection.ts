/**
 * Merge planner-authored demand projections into the item's demand-forecast
 * series for the planning chart.
 *
 * The planning RPCs (`get_production_planning`, `get_purchasing_planning`)
 * count actual + forecast + projection per period, so an item whose only
 * demand is a `demandProjection` is listed in the planning grid. The chart
 * reads the item forecast API instead, which historically read only
 * `demandActual` and `demandForecast` and charted such an item as having no
 * demand at all. This is the one place the two are reconciled.
 *
 * The chart assigns (does not accumulate) one "Demand Forecast" bucket per
 * period, so the result carries AT MOST ONE row that includes the projection
 * for any period: the first forecast row of that period absorbs it, and a
 * period with no forecast row gets a synthetic row built from the projection
 * (its `id` dropped so it cannot be mistaken for a `demandForecast` row).
 * Projections of zero or less contribute nothing.
 */
export type DemandForecastLike = {
  periodId: string;
  forecastQuantity: number | null;
};

export function mergeDemandProjections<
  TForecast extends DemandForecastLike,
  TProjection extends DemandForecastLike & { id: string }
>(
  forecasts: TForecast[],
  projections: TProjection[]
): Array<TForecast | Omit<TProjection, "id">> {
  const projectionByPeriod = new Map<string, number>();
  for (const projection of projections) {
    const quantity = projection.forecastQuantity ?? 0;
    if (quantity > 0) {
      projectionByPeriod.set(
        projection.periodId,
        (projectionByPeriod.get(projection.periodId) ?? 0) + quantity
      );
    }
  }

  const mergedPeriodIds = new Set<string>();
  const merged: Array<TForecast | Omit<TProjection, "id">> = forecasts.map(
    (forecast) => {
      const quantity = projectionByPeriod.get(forecast.periodId);
      if (!quantity || mergedPeriodIds.has(forecast.periodId)) return forecast;
      mergedPeriodIds.add(forecast.periodId);
      return {
        ...forecast,
        forecastQuantity: (forecast.forecastQuantity ?? 0) + quantity
      };
    }
  );

  for (const projection of projections) {
    const quantity = projectionByPeriod.get(projection.periodId);
    if (!quantity || mergedPeriodIds.has(projection.periodId)) continue;
    mergedPeriodIds.add(projection.periodId);
    const { id: _id, ...forecastFields } = projection;
    merged.push({ ...forecastFields, forecastQuantity: quantity });
  }

  return merged;
}
