import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  loadRampPurchaseInvoiceLines,
  loadRampPurchaseOrderLines
} from "./ramp-sync-outbound-lines";

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
    expect(ranges).toEqual([
      { table: "purchaseOrderLine", from: 0, to: 999 },
      { table: "purchaseOrderLine", from: 1000, to: 1999 }
    ]);
  });

  it("loads purchase-invoice lines beyond the PostgREST row cap", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      invoiceId: "pi_1",
      description: null,
      totalAmount: index,
      sortOrder: index
    }));
    const { client, ranges } = pagedClient({ purchaseInvoiceLine: rows });

    const result = await loadRampPurchaseInvoiceLines(client, "co_1", ["pi_1"]);

    expect(result).toHaveLength(1001);
    expect(result.at(-1)?.totalAmount).toBe(1000);
    expect(ranges).toEqual([
      { table: "purchaseInvoiceLine", from: 0, to: 999 },
      { table: "purchaseInvoiceLine", from: 1000, to: 1999 }
    ]);
  });
});
