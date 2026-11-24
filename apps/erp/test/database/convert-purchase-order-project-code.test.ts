// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { convertDocument } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  receiveFromPurchaseOrder,
  seed
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

databaseTest(
  "a PO-derived invoice snapshots only the configured project code while Ramp is active",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await receiveFromPurchaseOrder(f, "project");
      const orderId = `${f.prefix}-po-project`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("purchaseOrderPayment")
          .values({ id: orderId, companyId: f.companyId })
          .execute();
        await trx
          .insertInto("sequence")
          .values({
            table: "purchaseInvoice",
            name: "Purchase Invoice",
            prefix: "AP-",
            companyId: f.companyId
          })
          .execute();
        await trx
          .updateTable("purchaseOrder")
          .set({
            customFields: { orderProject: "P-42", buyerNote: "internal" }
          })
          .where("id", "=", orderId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("companyIntegration")
          .values({
            id: "ramp",
            companyId: f.companyId,
            active: true,
            metadata: {
              projectCodeValueType: "option",
              projectCodePoField: "orderProject",
              projectCodeInvoiceField: "invoiceProject",
              projectCodeFieldExternalId: "project"
            }
          })
          .execute();
      });

      const convert = () =>
        convertDocument(f.service, {
          type: "purchaseOrderToPurchaseInvoice",
          id: orderId
        });
      const first = await convert();
      await f.db
        .updateTable("purchaseOrder")
        .set({
          customFields: { orderProject: "P-43" }
        })
        .where("id", "=", orderId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .updateTable("companyIntegration")
        .set({ active: false })
        .where("id", "=", "ramp")
        .where("companyId", "=", f.companyId)
        .execute();
      const second = await convert();

      const readFields = async (id: string) =>
        (
          await f.db
            .selectFrom("purchaseInvoice")
            .select("customFields")
            .where("id", "=", id)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).customFields;
      expect(await readFields(first.id!)).toEqual({ invoiceProject: "P-42" });
      expect((await readFields(second.id!)) ?? {}).toEqual({});
    } finally {
      await f.cleanup();
    }
  }
);
