import { describe, expect, it } from "vitest";
import { fetchAllRecords } from "./utils";

// `fetchAllRecords` is the only thing standing between a >1000-row read and a
// silently truncated one, and the local dev stack does not enforce `max_rows`, so
// the paging arithmetic can only be pinned here. The contract: every row in
// order, one request when the table fits in a page, pages past the first issued
// concurrently, an error on any page propagating instead of partial data, and a
// server that ignores `Range` tripping the backstop rather than hanging.

type Row = { id: number };

/**
 * Mimics the two calls fetchAllRecords makes: the factory produces a fresh
 * builder, then `.range(from, to)` resolves to a PostgREST-shaped result. A
 * single shared builder would be wrong — the real one is mutable, which is why
 * the function takes a factory at all.
 */
function fakeTable(
  rows: Row[],
  opts: { ignoreRange?: boolean; errorOnPage?: number } = {}
) {
  const ranges: [number, number][] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const build = () =>
    ({
      range: (from: number, to: number) => {
        ranges.push([from, to]);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          setTimeout(() => {
            inFlight--;
            if (opts.errorOnPage === from / 1000) {
              resolve({ data: null, error: { message: "boom" } });
              return;
            }
            resolve({
              data: opts.ignoreRange
                ? rows.slice(0, to - from + 1)
                : rows.slice(from, to + 1),
              error: null
            });
          }, 0);
        });
      }
      // biome-ignore lint/suspicious/noExplicitAny: test double for a postgrest builder
    }) as any;

  return { build, ranges, maxInFlight: () => maxInFlight };
}

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("fetchAllRecords", () => {
  it("makes exactly one request when the table fits in a page", async () => {
    const { build, ranges } = fakeTable(rowsOf(77));

    const result = await fetchAllRecords<Row>(build);

    expect(ranges).toEqual([[0, 999]]);
    expect(result.data).toHaveLength(77);
    expect(result.count).toBe(77);
  });

  it("returns every row in order across pages", async () => {
    const { build } = fakeTable(rowsOf(2500));

    const result = await fetchAllRecords<Row>(build);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2500);
    expect(result.data?.map((r) => r.id)).toEqual(
      rowsOf(2500).map((r) => r.id)
    );
  });

  it("stops on an exact multiple without duplicating rows", async () => {
    const { build } = fakeTable(rowsOf(2000));

    const result = await fetchAllRecords<Row>(build);

    expect(result.data).toHaveLength(2000);
    expect(new Set(result.data?.map((r) => r.id)).size).toBe(2000);
  });

  it("issues the pages past the first concurrently", async () => {
    const { build, maxInFlight } = fakeTable(rowsOf(4500));

    await fetchAllRecords<Row>(build);

    expect(maxInFlight()).toBeGreaterThan(1);
  });

  it("propagates an error rather than returning a partial read", async () => {
    const { build } = fakeTable(rowsOf(4500), { errorOnPage: 2 });

    const result = await fetchAllRecords<Row>(build);

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("boom");
  });

  it("ignores a failure on a speculative page past the end of the data", async () => {
    // 1500 rows: page 1 is short, so it ends the read. Pages 2-4 went out in
    // the same wave before that was known, and a read past the end can fail
    // (PostgREST answers an out-of-range `Range` with 416) — that must not
    // discard rows already in hand.
    const { build } = fakeTable(rowsOf(1500), { errorOnPage: 2 });

    const result = await fetchAllRecords<Row>(build);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1500);
  });

  it("refuses to return a partial read when the server ignores Range", async () => {
    const { build } = fakeTable(rowsOf(1000), { ignoreRange: true });

    const result = await fetchAllRecords<Row>(build);

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("exceeded");
  });
});
