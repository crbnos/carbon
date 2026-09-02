import { describe, expect, it } from "vitest";
import { chunkFilterValues, selectInBatches } from "./supabase";

/**
 * The numbers here are the measured gateway limit, not a guess: an encoded
 * request line of 3,821 bytes succeeded against Supabase's Kong + PostgREST
 * and one of 4,001 failed. Every batch these produce has to leave room for the
 * path and the rest of the query on top of the filter itself.
 */

/** What supabase-js actually puts on the wire for `.in(column, values)`. */
function encodedFilterLength(column: string, values: string[]): number {
  const params = new URLSearchParams();
  params.append(
    column,
    `in.(${values.map((v) => (/[,()]/.test(v) ? `"${v}"` : v)).join(",")})`
  );
  return params.toString().length;
}

const partNumber = (i: number) => `PN-${String(i).padStart(6, "0")}`;
const externalId = (i: number) =>
  `d8247ee963c19d092f559c08:70719a8d835c474854aba1a1:J${String(i).padStart(2, "0")}D`;

describe("chunkFilterValues", () => {
  it("keeps every batch under the 4KB request line, for short values", () => {
    const values = Array.from({ length: 334 }, (_, i) => partNumber(i));
    const batches = chunkFilterValues(values);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(encodedFilterLength("readableId", batch)).toBeLessThan(3800);
    }
    expect(batches.flat()).toEqual(values);
  });

  it("keeps every batch under the limit for long values too", () => {
    // The case a fixed count of 100 gets wrong: 58-character external ids.
    const values = Array.from({ length: 334 }, (_, i) => externalId(i));
    const batches = chunkFilterValues(values);
    for (const batch of batches) {
      expect(encodedFilterLength("externalId", batch)).toBeLessThan(3800);
    }
    expect(batches.flat()).toEqual(values);
  });

  it("batches long values more aggressively than short ones", () => {
    const count = 334;
    const short = chunkFilterValues(
      Array.from({ length: count }, (_, i) => partNumber(i))
    );
    const long = chunkFilterValues(
      Array.from({ length: count }, (_, i) => externalId(i))
    );
    // Same number of values, longer strings, so strictly more requests. This
    // is the whole point of budgeting bytes rather than counting values.
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("accounts for the quotes supabase-js adds around , ( and )", () => {
    const values = Array.from({ length: 200 }, (_, i) => `PART,(${i})`);
    for (const batch of chunkFilterValues(values)) {
      expect(encodedFilterLength("readableId", batch)).toBeLessThan(3800);
    }
  });

  it("dedupes, and returns nothing for no values", () => {
    expect(chunkFilterValues(["a", "b", "a", "b"])).toEqual([["a", "b"]]);
    expect(chunkFilterValues([])).toEqual([]);
  });

  it("gives a value larger than the whole budget its own batch", () => {
    const huge = "x".repeat(5000);
    expect(chunkFilterValues(["a", huge, "b"])).toEqual([["a"], [huge], ["b"]]);
  });

  it("fits a small list in one request", () => {
    const values = Array.from({ length: 12 }, (_, i) => partNumber(i));
    expect(chunkFilterValues(values)).toEqual([values]);
  });
});

describe("selectInBatches", () => {
  it("concatenates the rows from every batch", async () => {
    const values = Array.from({ length: 334 }, (_, i) => externalId(i));
    const seen: string[][] = [];
    const result = await selectInBatches(values, (batch) => {
      seen.push(batch);
      return Promise.resolve({
        data: batch.map((value) => ({ value })),
        error: null
      });
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(result.error).toBeNull();
    expect(result.data.map((row) => row.value)).toEqual(values);
  });

  it("returns no rows alongside an error, and stops asking", async () => {
    const values = Array.from({ length: 334 }, (_, i) => externalId(i));
    let calls = 0;
    const result = await selectInBatches(values, () => {
      calls += 1;
      return Promise.resolve({ data: null, error: { message: "boom" } });
    });
    expect(calls).toBe(1);
    expect(result.error).toEqual({ message: "boom" });
    // A partial result read as a whole one is how a sync deletes live rows.
    expect(result.data).toEqual([]);
  });

  it("does not run a query at all for no values", async () => {
    let calls = 0;
    const result = await selectInBatches([], () => {
      calls += 1;
      return Promise.resolve({ data: [], error: null });
    });
    expect(calls).toBe(0);
    expect(result.data).toEqual([]);
  });
});
