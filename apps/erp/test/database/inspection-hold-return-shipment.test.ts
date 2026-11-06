// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { postShipment } from "../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

databaseTest(
  "a purchase return of 2 from a bin holding 1, with no inspection lot, posts",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const binId = `${f.prefix}-bin`;
      const returnId = `${f.prefix}-pro`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("storageUnit")
          .values({
            id: binId,
            name: "Bin A",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            entryType: "Positive Adjmt.",
            documentType: "Direct Transfer",
            itemId: f.partId,
            locationId: f.locationId,
            storageUnitId: binId,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseReturnOrder")
          .values({
            id: returnId,
            purchaseReturnOrderId: `${f.prefix}-PRO`,
            supplierId: f.supplierId,
            currencyCode: "USD",
            orderDate: f.today,
            locationId: f.locationId,
            status: "To Ship",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseReturnOrderLine")
          .values({
            purchaseReturnOrderId: returnId,
            itemId: f.partId,
            quantity: 2,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromPurchaseReturnOrder",
          purchaseReturnOrderId: returnId,
          locationId: f.locationId
        })
      ) as { id: string };
      await seed(f, (trx) =>
        trx
          .updateTable("shipmentLine")
          .set({ storageUnitId: binId })
          .where("shipmentId", "=", shipment.id)
          .where("companyId", "=", f.companyId)
          .execute()
      );

      await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
        f.db
      );
      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-shipment",
        { type: "post", shipmentId: shipment.id },
        postShipment
      );
      await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
        f.db
      );

      expect(posted.error).toBeNull();
      const onHand = await f.db
        .selectFrom("itemLedger")
        .select(sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity"))
        .where("storageUnitId", "=", binId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(onHand.quantity)).toBe(-1);
    } finally {
      await f.cleanup();
    }
  }
);
