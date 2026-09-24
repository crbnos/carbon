import { describe, expect, it } from "vitest";
import { mergeDemandProjections } from "./demand-projection";

const forecast = (periodId: string, forecastQuantity: number | null) => ({
  id: `df_${periodId}`,
  itemId: "item_1",
  locationId: "loc_1",
  periodId,
  forecastQuantity
});

const projection = (
  periodId: string,
  forecastQuantity: number | null,
  id = `dp_${periodId}`
) => ({
  id,
  itemId: "item_1",
  locationId: "loc_1",
  periodId,
  forecastQuantity
});

describe("mergeDemandProjections", () => {
  it("returns nothing when there are neither forecasts nor projections", () => {
    expect(mergeDemandProjections([], [])).toEqual([]);
  });

  it("charts a projection-only item: a period with no forecast row gets a synthetic row", () => {
    const merged = mergeDemandProjections([], [projection("p1", 40)]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      itemId: "item_1",
      locationId: "loc_1",
      periodId: "p1",
      forecastQuantity: 40
    });
    expect(merged[0]).not.toHaveProperty("id");
  });

  it("adds a projection onto the existing forecast row of the same period, not as a second row", () => {
    const merged = mergeDemandProjections(
      [forecast("p1", 10)],
      [projection("p1", 5)]
    );

    expect(merged).toEqual([{ ...forecast("p1", 10), forecastQuantity: 15 }]);
  });

  it("leaves forecast rows without a projection untouched", () => {
    const rows = [forecast("p1", 10), forecast("p2", 3)];
    const merged = mergeDemandProjections(rows, [projection("p2", 4)]);

    expect(merged).toEqual([
      forecast("p1", 10),
      { ...forecast("p2", 3), forecastQuantity: 7 }
    ]);
  });

  it("accumulates several projections in one period before merging", () => {
    const merged = mergeDemandProjections(
      [],
      [projection("p1", 5, "dp_a"), projection("p1", 7, "dp_b")]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].forecastQuantity).toBe(12);
  });

  it("applies a period's projection to only the first forecast row of that period", () => {
    const merged = mergeDemandProjections(
      [forecast("p1", 10), { ...forecast("p1", 2), id: "df_p1_dup" }],
      [projection("p1", 5)]
    );

    expect(merged).toEqual([
      { ...forecast("p1", 10), forecastQuantity: 15 },
      { ...forecast("p1", 2), id: "df_p1_dup" }
    ]);
  });

  it("ignores zero, negative and null projections", () => {
    const merged = mergeDemandProjections(
      [forecast("p1", 10)],
      [
        projection("p1", 0, "dp_zero"),
        projection("p1", -3, "dp_neg"),
        projection("p2", null, "dp_null"),
        projection("p3", 0, "dp_zero_2")
      ]
    );

    expect(merged).toEqual([forecast("p1", 10)]);
  });

  it("treats a null forecast quantity as zero when adding a projection", () => {
    const merged = mergeDemandProjections(
      [forecast("p1", null)],
      [projection("p1", 6)]
    );

    expect(merged).toEqual([{ ...forecast("p1", null), forecastQuantity: 6 }]);
  });

  it("interleaves periods correctly: forecast-only, both, and projection-only", () => {
    const merged = mergeDemandProjections(
      [forecast("p1", 10), forecast("p2", 20)],
      [projection("p2", 5), projection("p3", 8)],
      ["p1", "p2", "p3"]
    );

    expect(merged.map((r) => [r.periodId, r.forecastQuantity])).toEqual([
      ["p1", 10],
      ["p2", 25],
      ["p3", 8]
    ]);
  });

  it("places projection-only rows by the requested period sequence, not after the forecasts", () => {
    const merged = mergeDemandProjections(
      [forecast("p2", 20), forecast("p4", 40)],
      [projection("p1", 5), projection("p3", 8)],
      ["p1", "p2", "p3", "p4"]
    );

    expect(merged.map((r) => [r.periodId, r.forecastQuantity])).toEqual([
      ["p1", 5],
      ["p2", 20],
      ["p3", 8],
      ["p4", 40]
    ]);
  });

  it("reorders forecast rows that arrive out of period sequence", () => {
    const merged = mergeDemandProjections(
      [forecast("p3", 30), forecast("p1", 10)],
      [],
      ["p1", "p2", "p3"]
    );

    expect(merged.map((r) => r.periodId)).toEqual(["p1", "p3"]);
  });

  it("keeps rows for periods outside the sequence after the ordered ones, in input order", () => {
    const merged = mergeDemandProjections(
      [forecast("zz", 1), forecast("p2", 20), forecast("yy", 2)],
      [projection("p1", 5)],
      ["p1", "p2"]
    );

    expect(merged.map((r) => r.periodId)).toEqual(["p1", "p2", "zz", "yy"]);
  });

  it("keeps insertion order when no period sequence is given", () => {
    const merged = mergeDemandProjections(
      [forecast("p2", 20)],
      [projection("p1", 5)]
    );

    expect(merged.map((r) => r.periodId)).toEqual(["p2", "p1"]);
  });
});
