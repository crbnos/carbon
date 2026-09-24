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
