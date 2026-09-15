import { describe, expect, it } from "vitest";
import { consumeForecast } from "./forecast-consumption";

const WINDOW = { backwardPeriods: 4, forwardPeriods: 1 };

describe("consumeForecast", () => {
  it("nets same-bucket forecast 10 / actual 10 to remainder 0", () => {
    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast: new Map([[2, 10]]),
      actuals: new Map([[2, 10]]),
      window: WINDOW
    });
    expect(consumedByPeriod.get(2)).toBe(10);
    expect(remainderByPeriod.get(2)).toBe(0);
  });

  it("nets same-bucket forecast 10 / actual 5 to remainder 5 (total demand 10)", () => {
    const { remainderByPeriod } = consumeForecast({
      forecast: new Map([[2, 10]]),
      actuals: new Map([[2, 5]]),
      window: WINDOW
    });
    expect(remainderByPeriod.get(2)).toBe(5);
  });

  it("floors remainder at 0 when actuals exceed forecast (total demand 12)", () => {
    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast: new Map([[2, 10]]),
      actuals: new Map([[2, 12]]),
      window: WINDOW
    });
    expect(consumedByPeriod.get(2)).toBe(10);
    expect(remainderByPeriod.get(2)).toBe(0);
  });

  it("heals the gap case: forecast in weeks 2 and 4, actual in week 3 consumes week 2", () => {
    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast: new Map([
        [2, 10],
        [4, 10]
      ]),
      actuals: new Map([[3, 10]]),
      window: { backwardPeriods: 1, forwardPeriods: 1 }
    });
    expect(consumedByPeriod.get(2)).toBe(10);
    expect(remainderByPeriod.get(2)).toBe(0);
    expect(remainderByPeriod.get(4)).toBe(10);
  });

  it("prefers backward over forward when both are reachable", () => {
    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast: new Map([
        [1, 10],
        [3, 10]
      ]),
      actuals: new Map([[2, 6]]),
      window: { backwardPeriods: 1, forwardPeriods: 1 }
    });
    expect(consumedByPeriod.get(1)).toBe(6);
    expect(remainderByPeriod.get(1)).toBe(4);
    expect(remainderByPeriod.get(3)).toBe(10);
  });

  it("reaches forward when no backward forecast exists", () => {
    const { consumedByPeriod } = consumeForecast({
      forecast: new Map([[2, 10]]),
      actuals: new Map([[1, 10]]),
      window: WINDOW
    });
    expect(consumedByPeriod.get(2)).toBe(10);
  });

  it("consumes nothing when the only forecast is outside the window", () => {
    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast: new Map([[0, 5]]),
      actuals: new Map([[6, 10]]),
      window: WINDOW
    });
    expect(consumedByPeriod.get(0)).toBe(0);
    expect(remainderByPeriod.get(0)).toBe(5);
  });

  it("spills backward across multiple periods, nearest first", () => {
    const { remainderByPeriod } = consumeForecast({
      forecast: new Map([
        [1, 4],
        [2, 4]
      ]),
      actuals: new Map([[3, 10]]),
      window: { backwardPeriods: 2, forwardPeriods: 1 }
    });
    expect(remainderByPeriod.get(1)).toBe(0);
    expect(remainderByPeriod.get(2)).toBe(0);
  });

  it("degrades to strict per-bucket netting with a 0/0 window", () => {
    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast: new Map([[2, 10]]),
      actuals: new Map([
        [1, 10],
        [2, 3]
      ]),
      window: { backwardPeriods: 0, forwardPeriods: 0 }
    });
    expect(consumedByPeriod.get(2)).toBe(3);
    expect(remainderByPeriod.get(2)).toBe(7);
  });

  it("lets earlier actuals claim forecast first", () => {
    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast: new Map([[2, 10]]),
      actuals: new Map([
        [1, 8],
        [3, 8]
      ]),
      window: { backwardPeriods: 1, forwardPeriods: 1 }
    });
    // Period 1's actual reaches forward and takes 8; period 3's actual takes the last 2.
    expect(consumedByPeriod.get(2)).toBe(10);
    expect(remainderByPeriod.get(2)).toBe(0);
  });

  it("does not mutate its inputs and clamps negative forecast to 0", () => {
    const forecast = new Map([
      [2, -5],
      [3, 10]
    ]);
    const actuals = new Map([[3, 4]]);
    const { remainderByPeriod } = consumeForecast({
      forecast,
      actuals,
      window: WINDOW
    });
    expect(remainderByPeriod.get(2)).toBe(0);
    expect(remainderByPeriod.get(3)).toBe(6);
    expect(forecast.get(2)).toBe(-5);
    expect(actuals.get(3)).toBe(4);
  });
});
