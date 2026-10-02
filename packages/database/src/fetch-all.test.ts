// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
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
    }
  });
  return { build, ranges };
}

it("fetchAll returns every row, in order, across pages", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows);

  const result = await fetchAll<Row>(build);

  expect(result.error).toEqual(null);
  expect(result.data?.length).toEqual(2500);
  // Order matters: callers index operations by position against a parallel array.
  expect(result.data?.[0]?.id).toEqual(0);
  expect(result.data?.[1250]?.id).toEqual(1250);
  expect(result.data?.[2499]?.id).toEqual(2499);
  // 1000 + 1000 + 500 — the third page is short and ends the loop.
  expect(ranges).toEqual([
    [0, 999],
    [1000, 1999],
    [2000, 2999]
  ]);
});

it("fetchAll stops after one request when the first page is short", async () => {
  const rows = Array.from({ length: 42 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows);

  const result = await fetchAll<Row>(build);

  expect(result.data?.length).toEqual(42);
  expect(ranges.length).toEqual(1);
});

it("fetchAll issues a second request on an exactly-full page", async () => {
  // The boundary that makes truncation invisible: exactly max_rows rows look
  // identical to a truncated read, so a second page must be requested.
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows);

  const result = await fetchAll<Row>(build);

  expect(result.data?.length).toEqual(1000);
  expect(ranges.length).toEqual(2);
  expect(ranges[1]).toEqual([1000, 1999]);
});

it("fetchAll propagates an error instead of returning partial data", async () => {
  let call = 0;
  const build = () => ({
    range: (_from: number, _to: number) => {
      call++;
      if (call === 2) {
        return Promise.resolve({
          data: null,
          error: { message: "boom", code: "57014" }
        });
      }
      return Promise.resolve({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
        error: null
      });
    }
  });

  const result = await fetchAll<Row>(build);

  // Partial data here would be indistinguishable from a complete read — the
  // exact failure the helper exists to prevent.
  expect(result.data).toEqual(null);
  expect(result.error?.message).toEqual("boom");
  // The whole PostgREST error survives, diagnostics included.
  expect(result.error?.code).toEqual("57014");
});

it("fetchAll refuses to loop forever when the server ignores Range", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const { build, ranges } = fakeTable(rows, { ignoreRange: true });

  const result = await fetchAll<Row>(build);

  expect(result.data).toEqual(null);
  expect(result.error?.message ?? "").toContain("refusing to plan");
  expect(ranges.length).toEqual(1000);
});

it("fetchAll handles an empty result set", async () => {
  const { build, ranges } = fakeTable([]);

  const result = await fetchAll<Row>(build);

  expect(result.error).toEqual(null);
  expect(result.data).toEqual([]);
  expect(ranges.length).toEqual(1);
});
