import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadRampPurchaseOrderLines } from "./ramp-sync-outbound-lines";

function pagedClient(rowsByTable: Record<string, object[]>) {
  const ranges: Array<{ table: string; from: number; to: number }> = [];
  const client = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        neq: () => builder,
        order: () => builder,
        range: async (from: number, to: number) => {
          ranges.push({ table, from, to });
          const rows = rowsByTable[table] ?? [];
          return {
            data: rows.slice(from, to + 1),
            error: null,
            count: rows.length
          };
        }
      };
      return builder;
    }
  } as unknown as SupabaseClient<Database>;
  return { client, ranges };
}

describe("Ramp outbound line pagination", () => {
  it("loads purchase-order lines beyond the PostgREST row cap", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `pol_${index}`,
      purchaseOrderId: "po_1",
      description: null,
      purchaseQuantity: 1,
      supplierUnitPrice: index,
      purchaseOrderLineType: "Part",
      sortOrder: index
    }));
    const { client, ranges } = pagedClient({ purchaseOrderLine: rows });

    const result = await loadRampPurchaseOrderLines(client, "co_1", ["po_1"]);

    expect(result).toHaveLength(1001);
    expect(result.at(-1)?.id).toBe("pol_1000");
    // The 1001st row lives on the second page, so pagination must reach past the
    // 1000-row cap. `fetchAllRecords` fetches pages speculatively in concurrent
    // waves (PAGE_CONCURRENCY) and returns on the first short page, so it may
    // issue extra out-of-range reads after [1000, 1999]; assert only the two
    // data-bearing pages rather than coupling to the concurrency window.
    expect(ranges.slice(0, 2)).toEqual([
      { table: "purchaseOrderLine", from: 0, to: 999 },
      { table: "purchaseOrderLine", from: 1000, to: 1999 }
    ]);
  });
});
