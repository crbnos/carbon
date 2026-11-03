// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The list search reads the computed fields
// "searchText" and "searchLines" of the list views (migration
// *_deep-list-search.sql) through the same service the list page calls.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { getPurchaseOrders } from "../../app/modules/purchasing/purchasing.service";
import { matchingSearchLines, searchTerms } from "../../app/utils/search";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

let f: Fixture;
let purchaseOrderId: string;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
  purchaseOrderId = `${f.prefix}-po-search`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: `${f.prefix}-PO-SEARCH`,
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values({
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        description: "Spacer for the bracket",
        supplierPartId: "BRK-514",
        purchaseQuantity: 10,
        supplierUnitPrice: 1,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}, 60_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await f.cleanup();
}, 60_000);

// `forScreen` is what the list page passes; an export or the API leaves it out.
const search = (
  client: Parameters<typeof getPurchaseOrders>[0],
  text: string,
  forScreen = true
) =>
  getPurchaseOrders(client, f.companyId, {
    search: text,
    status: null,
    supplierId: null,
    limit: 10,
    forScreen
  });

describe("Purchase Orders search by line values", () => {
  postgrestTest(
    "finds the order by a line's part number, punctuation ignored, and returns that line",
    async (client) => {
      const result = await search(client, "brk 514");
      expect(result.error).toBeNull();
      const rows = result.data ?? [];
      expect(rows.map((row) => row.id)).toEqual([purchaseOrderId]);
      // Every line the search matched is a line the row can show.
      expect(
        matchingSearchLines(rows[0]!, searchTerms("brk 514")).map(
          (line) => line.partNumber
        )
      ).toEqual(["BRK-514"]);
    }
  );

  postgrestTest("needs every word to match", async (client) => {
    const result = await search(client, "brk514 zzqqxxnomatch");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  postgrestTest(
    "matches the item and the order number as well",
    async (client) => {
      for (const text of [`${f.prefix}-PART`, "bracket", `${f.prefix}-PO-SEARCH`]) {
        const result = await search(client, text);
        expect(result.error).toBeNull();
        expect((result.data ?? []).map((row) => row.id)).toEqual([
          purchaseOrderId
        ]);
      }
    }
  );

  postgrestTest(
    "reads the lines for the screen only, never for select=* or an export",
    async (client) => {
      const star = await client
        .from("purchaseOrders")
        .select("*")
        .eq("id", purchaseOrderId)
        .single();
      expect(star.error).toBeNull();
      expect(star.data).not.toHaveProperty("searchText");
      expect(star.data).not.toHaveProperty("searchLines");

      const screen = await search(client, "");
      expect(screen.error).toBeNull();
      expect(screen.data?.[0]?.id).toBe(purchaseOrderId);
      expect(screen.data?.[0]).toHaveProperty("searchLines");

      const exported = await search(client, "brk514", false);
      expect(exported.error).toBeNull();
      expect(exported.data?.[0]?.id).toBe(purchaseOrderId);
      expect(exported.data?.[0]).not.toHaveProperty("searchLines");
    }
  );
});
