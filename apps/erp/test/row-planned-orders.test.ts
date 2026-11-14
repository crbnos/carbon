// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The planning grids read the planned orders of the rows a bulk Make / Order
// sizes. Production's PostgREST answers at most 1000 rows a request
// (`max_rows`), and the local stack does not, so the cut only shows against a
// table that enforces it.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  getDrawerPlannedOrders,
  getRowPlannedOrders
} from "../app/modules/production/production.utils";

const MAX_ROWS = 1000;

type Row = Record<string, string | number>;

/**
 * A `plannedOrder` table behind a PostgREST-shaped builder: it keeps rows,
 * applies `eq` / `in` / `order` / `range`, and answers at most `MAX_ROWS`.
 */
function plannedOrderTable(rows: Row[]) {
  const from = () => {
    const filters: ((row: Row) => boolean)[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let range: [number, number] | null = null;
    const run = () => {
      const sorted = rows.filter((row) => filters.every((f) => f(row)));
      sorted.sort((a, b) => {
        for (const { column, ascending } of orders) {
          const order = String(a[column]).localeCompare(String(b[column]));
          if (order !== 0) return ascending ? order : -order;
        }
        return 0;
      });
      const page = range ? sorted.slice(range[0], range[1] + 1) : sorted;
      return { data: page.slice(0, MAX_ROWS), error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: string[]) => {
        filters.push((row) => values.includes(String(row[column])));
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        orders.push({ column, ascending: options?.ascending ?? true });
        return builder;
      },
      range: (start: number, end: number) => {
        range = [start, end];
        return builder;
      },
      // biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is awaited
      then: (
        resolve: (value: ReturnType<typeof run>) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve().then(run).then(resolve, reject)
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

const plannedOrder = (
  id: string,
  overrides: Partial<Row> = {}
): Row => ({
  id,
  companyId: "c1",
  itemId: "item-a",
  locationId: "loc1",
  orderType: "Make",
  planningSegmentId: "",
  status: "Planned",
  dueDate: "2026-10-06",
  ...overrides
});

const many = (count: number, prefix: string, overrides: Partial<Row> = {}) =>
  Array.from({ length: count }, (_, i) =>
    plannedOrder(`${prefix}-${String(i).padStart(5, "0")}`, overrides)
  );

describe("planned order reads past max_rows", () => {
  it("reads every planned order of the rows, not the first 1000", async () => {
    const client = plannedOrderTable([
      ...many(1250, "a"),
      ...many(30, "b", { itemId: "item-b" }),
      // not the read's: another location, a Buy order, a Converted one
      plannedOrder("other-location", { locationId: "loc2" }),
      plannedOrder("buy", { orderType: "Buy" }),
      plannedOrder("converted", { status: "Converted" })
    ]);
    const read = await getRowPlannedOrders(client, {
      companyId: "c1",
      locationId: "loc1",
      orderType: "Make",
      itemIds: ["item-a", "item-b"]
    });
    expect(read.error).toBeNull();
    expect(new Set(read.data?.map((order) => order.id)).size).toBe(1280);
  });

  it("reads every planned order of the drawer's item, by due date", async () => {
    const client = plannedOrderTable([
      ...many(1100, "a", { dueDate: "2026-10-13" }),
      plannedOrder("first", { dueDate: "2026-10-01" })
    ]);
    const read = await getDrawerPlannedOrders(client, {
      companyId: "c1",
      itemId: "item-a",
      locationId: "loc1",
      orderType: "Make"
    });
    expect(read.data?.length).toBe(1101);
    expect(read.data?.[0]?.id).toBe("first");
  });
});
