import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { fetchAll } from "./fetch-all.ts";

// `fetchAll` is the only thing standing between a >1000-row read and a silently
// truncated one, and the local dev stack does not enforce `max_rows` — so the
// paging arithmetic can only be pinned here, never by running the app. The
// contract: every row is returned in order, the loop stops on the first short
// page, an error on any page propagates instead of yielding partial data, and a
// server that ignores `Range` trips the backstop rather than hanging.

type Row = { id: number };

/**
 * A builder that mimics the two calls fetchAll makes: the factory produces a
 * fresh builder, then `.range(from, to)` resolves to a PostgREST-shaped result.
 * Records every requested range so page arithmetic is observable.
 */
function fakeTable(rows: Row[], opts: { ignoreRange?: boolean } = {}) {
  const ranges: [number, number][] = [];
  const build = () => ({
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      // A server ignoring Range returns a full page every time — the condition
      // the MAX_PAGES backstop exists for.
      const page = opts.ignoreRange
        ? rows.slice(0, to - from + 1)
        : rows.slice(from, to + 1);
      return Promise.resolve({ data: page, error: null });
    },
  });
  return { build, ranges };
}

Deno.test("fetchAll returns every row, in order, across pages", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows);

  const result = await fetchAll<Row>(build);

  assertEquals(result.error, null);
  assertEquals(result.data?.length, 2500);
  // Order matters: callers index operations by position against a parallel array.
  assertEquals(result.data?.[0].id, 0);
  assertEquals(result.data?.[1250].id, 1250);
  assertEquals(result.data?.[2499].id, 2499);
  // 1000 + 1000 + 500 — the third page is short and ends the loop.
  assertEquals(ranges, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

Deno.test("fetchAll stops after one request when the first page is short", async () => {
  const rows = Array.from({ length: 42 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows);

  const result = await fetchAll<Row>(build);

  assertEquals(result.data?.length, 42);
  assertEquals(ranges.length, 1);
});

Deno.test("fetchAll issues a second request on an exactly-full page", async () => {
  // The boundary that makes truncation invisible: exactly max_rows rows look
  // identical to a truncated read, so a second page must be requested.
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows);

  const result = await fetchAll<Row>(build);

  assertEquals(result.data?.length, 1000);
  assertEquals(ranges.length, 2);
  assertEquals(ranges[1], [1000, 1999]);
});

Deno.test("fetchAll propagates an error instead of returning partial data", async () => {
  let call = 0;
  const build = () => ({
    range: (_from: number, _to: number) => {
      call++;
      if (call === 2) {
        return Promise.resolve({
          data: null,
          error: { message: "boom", code: "57014" },
        });
      }
      return Promise.resolve({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
        error: null,
      });
    },
  });

  const result = await fetchAll<Row>(build);

  // Partial data here would be indistinguishable from a complete read — the
  // exact failure the helper exists to prevent.
  assertEquals(result.data, null);
  assertEquals(result.error?.message, "boom");
  // The whole PostgREST error survives, diagnostics included.
  assertEquals(result.error?.code, "57014");
});

Deno.test("fetchAll refuses to loop forever when the server ignores Range", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows, { ignoreRange: true });

  const result = await fetchAll<Row>(build);

  assertEquals(result.data, null);
  assertStringIncludes(result.error?.message ?? "", "refusing to plan");
  assertEquals(ranges.length, 1000);
});

Deno.test("fetchAll handles an empty result set", async () => {
  const { build, ranges } = fakeTable([]);

  const result = await fetchAll<Row>(build);

  assertEquals(result.error, null);
  assertEquals(result.data, []);
  assertEquals(ranges.length, 1);
});
