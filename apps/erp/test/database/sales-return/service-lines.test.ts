// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. A Return for Service or Return for Warranty
// unit stays the customer's: it is never credited, and the whole-RMA
// replacement leaves it out (it is replaced from its own line).

import { describe, expect, it } from "vitest";
import {
  createReplacementSalesOrder,
  createSalesReturnOrderCredit,
  getCreditableQuantities
} from "../../../app/modules/sales/sales.service";
import { hasLocalDatabase } from "../fixtures/local-database";
import { localServiceRoleClient } from "../fixtures/local-supabase";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { serviceReturnFixture } from "../fixtures/service-return";

const client = hasLocalDatabase ? localServiceRoleClient() : null;

describe.skipIf(!client)("an RMA's Service and Warranty lines", () => {
  it("are not creditable, and the whole-RMA replacement leaves them out", async () => {
    const f = await serviceReturnFixture();
    try {
      await f.db
        .insertInto("sequence")
        .values({
          table: "creditMemo",
          name: "Credit Memo",
          prefix: "CM",
          companyId: f.companyId
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.stockItemId, returnType: "Return to Stock" },
        { itemId: f.unitItemId, returnType: "Return for Service" },
        { itemId: f.unitItemId, returnType: "Return for Warranty" }
      ]);
      const [stockLineId, serviceLineId, warrantyLineId] = lineIds as [
        string,
        string,
        string
      ];
      expect((await f.receive(rmaId)).posted.error).toBeNull();

      const creditable = await getCreditableQuantities(
        client!,
        rmaId,
        f.companyId
      );
      expect(creditable.error).toBeNull();
      expect(
        creditable.data?.map((line) => line.salesReturnOrderLineId)
      ).toEqual([stockLineId]);

      for (const lineId of [serviceLineId, warrantyLineId]) {
        await expect(
          createSalesReturnOrderCredit(client!, f.db, {
            salesReturnOrderId: rmaId,
            companyId: f.companyId,
            companyGroupId: f.groupId,
            userId: PROJECT_TEST_USER,
            memoDate: "2026-10-01",
            lines: [{ salesReturnOrderLineId: lineId, quantity: 1 }]
          })
        ).rejects.toThrow(/is not credited/);
      }

      // An RMA of only serviced units has nothing for the whole-RMA path.
      const { rmaId: servicedRmaId } = await f.addRma([
        { itemId: f.unitItemId, returnType: "Return for Service" },
        { itemId: f.unitItemId, returnType: "Return for Warranty" }
      ]);
      expect((await f.receive(servicedRmaId)).posted.error).toBeNull();
      const replacement = await createReplacementSalesOrder(client!, {
        salesReturnOrderId: servicedRmaId,
        companyId: f.companyId,
        companyGroupId: f.groupId,
        userId: PROJECT_TEST_USER
      });
      expect(replacement.error?.message).toBe(
        "Return order has no Return to Stock lines to replace"
      );
      const replaced = await f.db
        .selectFrom("salesOrderLine")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(replaced).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
});
