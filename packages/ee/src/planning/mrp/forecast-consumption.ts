export type ConsumptionWindow = {
  /** How many periods BEFORE the actual's period may be consumed (0 = own period only). */
  backwardPeriods: number;
  /** How many periods AFTER the actual's period may be consumed. */
  forwardPeriods: number;
};

export type ConsumptionResult = {
  /** periodIndex -> quantity consumed from that period's forecast (0 ≤ consumed ≤ forecast). */
  consumedByPeriod: Map<number, number>;
  /** periodIndex -> forecast − consumed, floored at 0. Every input forecast period has an entry. */
  remainderByPeriod: Map<number, number>;
};

/**
 * Forecast consumption: actual demand consumes the authored forecast so the two
 * never double-count. Each actual consumes its own period's forecast first, then
 * searches backward (nearest first) up to `backwardPeriods`, then forward up to
 * `forwardPeriods`. Backward-before-forward is the industry consensus (SAP
 * consumption mode 2, Oracle, SyteLine): an order landing "late" relative to a
 * forecast bucket was almost certainly part of the just-passed forecast.
 *
 * Actual quantity beyond the reachable forecast consumes nothing further — it
 * simply stands as real demand (the caller adds actuals in full; only the
 * forecast remainder is what this function decides).
 */
export function consumeForecast(args: {
  /** periodIndex -> authored forecast quantity (entries may be 0; negative treated as 0). */
  forecast: Map<number, number>;
  /** periodIndex -> total consuming actual quantity (SO quantityToConsume + job-material quantityToIssue). */
  actuals: Map<number, number>;
  window: ConsumptionWindow;
}): ConsumptionResult {
  const { forecast, actuals, window } = args;

  const remaining = new Map<number, number>();
  const consumedByPeriod = new Map<number, number>();
  for (const [periodIndex, quantity] of forecast) {
    remaining.set(periodIndex, Math.max(quantity, 0));
    consumedByPeriod.set(periodIndex, 0);
  }

  const actualIndices = [...actuals.keys()].sort((a, b) => a - b);
  for (const periodIndex of actualIndices) {
    let quantity = actuals.get(periodIndex) ?? 0;
    if (quantity <= 0) continue;

    const candidates: number[] = [periodIndex];
    for (let back = 1; back <= window.backwardPeriods; back++) {
      const candidate = periodIndex - back;
      if (candidate < 0) break;
      candidates.push(candidate);
    }
    for (let forward = 1; forward <= window.forwardPeriods; forward++) {
      candidates.push(periodIndex + forward);
    }

    for (const candidate of candidates) {
      if (quantity <= 0) break;
      const available = remaining.get(candidate) ?? 0;
      if (available <= 0) continue;
      const take = Math.min(quantity, available);
      remaining.set(candidate, available - take);
      consumedByPeriod.set(
        candidate,
        (consumedByPeriod.get(candidate) ?? 0) + take
      );
      quantity -= take;
    }
  }

  const remainderByPeriod = new Map<number, number>();
  for (const [periodIndex] of consumedByPeriod) {
    remainderByPeriod.set(periodIndex, remaining.get(periodIndex) ?? 0);
  }

  return { consumedByPeriod, remainderByPeriod };
}
