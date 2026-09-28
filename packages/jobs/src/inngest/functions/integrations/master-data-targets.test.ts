import { describe, expect, it } from "vitest";
import { collectPagedIds } from "./master-data-targets";

/**
 * `collectPagedIds` exists because the changed-master-data set was read with a
 * single `.limit()`. Reconciling a row does not move its `updatedAt`, so a swept
 * row keeps matching the window for the whole lookback — the query returned the
 * SAME newest rows every pass and every row past the limit was never swept at
 * all, which is precisely the dropped-event recovery the sweep exists to give.
 *
 * The bug was in the loop, not the query, so that is what these pin.
 */
describe("collectPagedIds", () => {
  /** A reader over a fixed row set, recording the offsets it was asked for. */
  const reader = (total: number) => {
    const calls: Array<{ offset: number; size: number }> = [];
    const all = Array.from({ length: total }, (_, i) => `id-${i}`);
    return {
      calls,
      fetchPage: async (offset: number, size: number) => {
        calls.push({ offset, size });
        return all.slice(offset, offset + size);
      }
    };
  };

  it("returns every row when the set spans more than one page", async () => {
    // The regression. A single-page read returns 200 of these and silently
    // strands 450 rows until they age out of the window.
    const r = reader(650);
    const ids = await collectPagedIds({
      fetchPage: r.fetchPage,
      pageSize: 200,
      maxPages: 25
    });

    expect(ids).toHaveLength(650);
    expect(ids[0]).toBe("id-0");
    expect(ids.at(-1)).toBe("id-649");
    expect(new Set(ids).size).toBe(650);
    expect(r.calls.map((c) => c.offset)).toEqual([0, 200, 400, 600]);
  });

  it("stops on the first short page instead of reading past the end", async () => {
    const r = reader(250);
    await collectPagedIds({
      fetchPage: r.fetchPage,
      pageSize: 200,
      maxPages: 25
    });

    // Page 2 came back short, which is proof there is no page 3.
    expect(r.calls.map((c) => c.offset)).toEqual([0, 200]);
  });

  it("reads once for a set that fits in a page, and not at all past it", async () => {
    const r = reader(7);
    const ids = await collectPagedIds({
      fetchPage: r.fetchPage,
      pageSize: 200,
      maxPages: 25
    });

    expect(ids).toHaveLength(7);
    expect(r.calls).toHaveLength(1);
  });

  it("returns nothing for an empty set, without a second read", async () => {
    const r = reader(0);
    const ids = await collectPagedIds({
      fetchPage: r.fetchPage,
      pageSize: 200,
      maxPages: 25
    });

    expect(ids).toEqual([]);
    expect(r.calls).toHaveLength(1);
  });

  it("honours the page ceiling rather than walking a runaway table forever", async () => {
    // An exactly-full last page keeps the loop going, so the ceiling is the only
    // thing that ends it. One company's oversized table must not eat the sweep.
    const r = reader(10_000);
    const ids = await collectPagedIds({
      fetchPage: r.fetchPage,
      pageSize: 200,
      maxPages: 3
    });

    expect(ids).toHaveLength(600);
    expect(r.calls).toHaveLength(3);
  });

  it("propagates a read failure instead of returning a short set", async () => {
    // A swallowed error here would look exactly like "nothing changed", and the
    // sweep would report a clean pass while recovering nothing.
    let call = 0;
    await expect(
      collectPagedIds({
        pageSize: 200,
        maxPages: 25,
        fetchPage: async () => {
          call += 1;
          if (call === 2) throw new Error("PostgREST exploded");
          return Array.from({ length: 200 }, (_, i) => `id-${i}`);
        }
      })
    ).rejects.toThrow("PostgREST exploded");
  });
});
