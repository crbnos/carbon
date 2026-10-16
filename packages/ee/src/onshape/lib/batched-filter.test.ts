// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { chunkFilterValues, selectInBatches } from "./batched-filter";

// Measured gateway limit: a 3,821-byte request line succeeds, 4,001 fails.

/** What supabase-js puts on the wire for `.in(column, values)`. */
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

/**
 * A fake supabase-js builder over `rows`: `.in()` is the batch, `.order()` and
 * `.range()` behave as PostgREST's do, and a page never exceeds `maxRows`.
 */
function fakeTable<Row extends { id: string; key: string }>(
  rows: Row[],
  log: { pages: Array<{ batch: string[]; from: number; to: number }> },
  maxRows = 1000
) {
  return (batch: string[]) => {
    const orders: string[] = [];
    const query = {
      order(column: string) {
        orders.push(column);
        return query;
      },
      range(from: number, to: number) {
        log.pages.push({ batch, from, to });
        const matched = rows
          .filter((row) => batch.includes(row.key))
          .sort((a, b) => {
            for (const column of orders) {
              const left = String(a[column as keyof Row]);
              const right = String(b[column as keyof Row]);
              if (left !== right) return left < right ? -1 : 1;
            }
            return 0;
          });
        const end = Math.min(to + 1, from + maxRows);
        return Promise.resolve({
          data: matched.slice(from, end),
          error: null as { message: string } | null
        });
      }
    };
    return query;
  };
}

describe("selectInBatches", () => {
  it("concatenates the rows from every batch", async () => {
    const values = Array.from({ length: 334 }, (_, i) => externalId(i));
    const log = {
      pages: [] as Array<{ batch: string[]; from: number; to: number }>
    };
    const rows = values.map((key) => ({ id: key, key }));
    const result = await selectInBatches(values, fakeTable(rows, log));
    expect(log.pages.length).toBeGreaterThan(1);
    expect(result.error).toBeNull();
    // Batches arrive in batch order; each batch in id order.
    expect(result.data.map((row) => row.key).sort()).toEqual(
      [...values].sort()
    );
  });

  it("pages a batch that matches more than 1,000 rows", async () => {
    // One method id with 2,500 BOM lines: a single read stops at 1,000.
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      id: `line-${String(i).padStart(5, "0")}`,
      key: "method-1"
    }));
    const log = {
      pages: [] as Array<{ batch: string[]; from: number; to: number }>
    };
    const result = await selectInBatches(["method-1"], fakeTable(rows, log));
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2500);
    expect(new Set(result.data.map((row) => row.id)).size).toBe(2500);
    expect(log.pages.map((page) => [page.from, page.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ]);
  });

  it("asks for one more page when the last one is exactly full", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `line-${String(i).padStart(5, "0")}`,
      key: "method-1"
    }));
    const log = {
      pages: [] as Array<{ batch: string[]; from: number; to: number }>
    };
    const result = await selectInBatches(["method-1"], fakeTable(rows, log));
    expect(result.data).toHaveLength(1000);
    expect(log.pages).toHaveLength(2);
  });

  it("orders every page by id after the query's own order", async () => {
    const orders: string[][] = [];
    await selectInBatches(["a"], () => {
      const seen: string[] = [];
      orders.push(seen);
      const query = {
        order(column: string) {
          seen.push(column);
          return query;
        },
        range: () => Promise.resolve({ data: [], error: null })
      };
      return query.order("revision");
    });
    expect(orders).toEqual([["revision", "id"]]);
  });

  it("returns no rows alongside an error, and stops asking", async () => {
    const values = Array.from({ length: 334 }, (_, i) => externalId(i));
    let calls = 0;
    const result = await selectInBatches(values, () => {
      const query = {
        order: () => query,
        range: () => {
          calls += 1;
          return Promise.resolve({ data: null, error: { message: "boom" } });
        }
      };
      return query;
    });
    expect(calls).toBe(1);
    expect(result.error).toEqual({ message: "boom" });
    expect(result.data).toEqual([]);
  });

  it("does not run a query at all for no values", async () => {
    let calls = 0;
    const result = await selectInBatches([], () => {
      calls += 1;
      const query = {
        order: () => query,
        range: () => Promise.resolve({ data: [], error: null })
      };
      return query;
    });
    expect(calls).toBe(0);
    expect(result.data).toEqual([]);
  });
});
