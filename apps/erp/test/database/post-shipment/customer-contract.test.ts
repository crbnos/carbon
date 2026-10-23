// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Contract deliveries (spec section 10.4): a delivery of a part CLIN moves no
// stock and posts no journal; a Fixed Price line's delivered units take their
// share of its next billing event to the delivery date, and void puts it back.
// Runs `create` and `post-shipment` through their real entry points on a
// scratch company that is deleted afterwards.

import { sql } from "kysely";
import { expect } from "vitest";
import { postShipment } from "../../../app/modules/inventory/inventory.service";
import { postCustomerContract } from "../../../app/modules/sales/sales.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../fixtures/local-database";

const USER = "system";

async function deliveryFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `deltest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const customerId = `${prefix}-customer`;
  const partId = `${prefix}-part`;
  const locationId = `${prefix}-location`;
  const projectId = `${prefix}-project`;
  const elementId = `${prefix}-element`;
  const contractId = `${prefix}-contract`;
  const fixedLineId = `${prefix}-fixed`;
  const tmLineId = `${prefix}-tm`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("currency")
      .values({
        code: "USD",
        decimalPlaces: 2,
        companyGroupId: groupId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("companySettings")
      .values({ id: companyId })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "shipment",
        name: "Shipment",
        prefix: "SHP-",
        companyId
      })
      .execute();
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: prefix, companyId })
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: "Headquarters",
        addressLine1: "1 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "EA", name: "Each", companyId, createdBy: USER })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: partId,
        readableId: `${prefix}-PROTO`,
        name: "Prototype",
        type: "Part",
        itemTrackingType: "Inventory",
        unitOfMeasureCode: "EA",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("project")
      .values({
        id: projectId,
        name: prefix,
        identifier: "PD",
        status: "Released",
        costTreatment: "Contract",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("projectState")
      .values({
        id: `${projectId}-todo`,
        name: `Todo ${projectId}`,
        group: "Unstarted",
        color: "#000000",
        sortOrder: 0,
        isDefault: false,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("projectElement")
      .values({
        id: elementId,
        projectId,
        readableId: "PD-1",
        sequence: 1,
        type: "Task",
        name: "Prototype build",
        isBilling: true,
        stateId: `${projectId}-todo`,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("customerContract")
      .values({
        id: contractId,
        customerContractId: "CON-DEL",
        name: "Prototype contract",
        customerId,
        billingBasis: "Project",
        status: "Active",
        projectId,
        closeDate: "2026-01-01",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        billingFrequency: "Month",
        billingAlignment: "Calendar",
        billingTiming: "Arrears",
        currencyCode: "USD",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("customerContractLine")
      .values([
        {
          id: fixedLineId,
          customerContractId: contractId,
          revenueType: "One-time",
          itemId: partId,
          description: "Prototype, Fixed Price",
          lineItemNumber: "0001",
          quantity: 2,
          rate: 40_000,
          startDate: "2026-01-01",
          billingMethod: "Fixed",
          revenueMethod: "Daily",
          projectId,
          sortOrder: 1,
          companyId,
          createdBy: USER
        },
        {
          id: tmLineId,
          customerContractId: contractId,
          revenueType: "One-time",
          itemId: partId,
          description: "Prototype, T&M",
          lineItemNumber: "0002",
          quantity: 2,
          rate: 0,
          startDate: "2026-01-01",
          billingMethod: "Time & Materials",
          revenueMethod: "Right to Invoice",
          projectId,
          projectElementId: elementId,
          sortOrder: 2,
          companyId,
          createdBy: USER
        }
      ])
      .execute();
    // The Fixed Price line's one billing event: both units at 80,000.
    await trx
      .insertInto("customerContractInvoice")
      .values({
        id: `${prefix}-event`,
        customerContractId: contractId,
        invoiceDate: "2026-12-31",
        status: "Planned",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("customerContractInvoiceLine")
      .values({
        id: `${prefix}-event-row`,
        customerContractId: contractId,
        customerContractInvoiceId: `${prefix}-event`,
        customerContractLineId: fixedLineId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-01",
        units: 1,
        unitPrice: 40_000,
        amount: 80_000,
        isAdjustment: false,
        companyId,
        createdBy: USER
      })
      .execute();
    // One unit of each line is built.
    await trx
      .insertInto("job")
      .values(
        [fixedLineId, tmLineId].map((lineId, index) => ({
          id: `${prefix}-job-${index}`,
          jobId: `J-${prefix}-${index}`,
          itemId: partId,
          quantity: 2,
          quantityComplete: 1,
          locationId,
          unitOfMeasureCode: "EA",
          projectId,
          projectElementId: elementId,
          consumeToProject: true,
          customerContractLineId: lineId,
          companyId,
          createdBy: USER
        }))
      )
      .execute();
  });

  const ctx = { db, companyId, userId: USER };

  return {
    db,
    ctx,
    companyId,
    contractId,
    partId,
    fixedLineId,
    tmLineId,
    async deliver(lineId: string) {
      const result = await invokeCreate(handlesOf(ctx), {
        type: "shipmentFromCustomerContract",
        customerContractId: contractId,
        customerContractLineId: lineId
      });
      if (result.error || !result.data) throw result.error;
      return result.data.id;
    },
    async schedule() {
      return db
        .selectFrom("customerContractInvoiceLine as r")
        .innerJoin("customerContractInvoice as i", (join) =>
          join
            .onRef("i.id", "=", "r.customerContractInvoiceId")
            .onRef("i.companyId", "=", "r.companyId")
        )
        .select([
          sql<string>`i."invoiceDate"::text`.as("invoiceDate"),
          "r.amount"
        ])
        .where("r.customerContractLineId", "=", fixedLineId)
        .where("r.companyId", "=", companyId)
        .orderBy("i.invoiceDate")
        .execute()
        .then((rows) =>
          rows.map((row) => [row.invoiceDate, Number(row.amount)])
        );
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}

databaseTest(
  "a T&M part delivery records custody: no stock, no journal, and no more than its jobs built",
  async () => {
    const f = await deliveryFixture();
    const { db, ctx, companyId } = f;
    try {
      const shipmentId = await f.deliver(f.tmLineId);
      const line = await db
        .selectFrom("shipmentLine")
        .select(["id", "shippedQuantity"])
        .where("shipmentId", "=", shipmentId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      expect(Number(line.shippedQuantity)).toBe(1);

      // Two units, but the job completed one.
      await db
        .updateTable("shipmentLine")
        .set({ shippedQuantity: 2, serialNumber: "SN-001" })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
      const refused = await invokePosting(handlesOf(ctx), "post-shipment", {
        type: "post",
        shipmentId,
        postingDate: "2026-06-01"
      }, postShipment);
      expect(refused.error?.message).toContain("1 built and not delivered");

      await db
        .updateTable("shipmentLine")
        .set({ shippedQuantity: 1 })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
      const posted = await invokePosting(handlesOf(ctx), "post-shipment", {
        type: "post",
        shipmentId,
        postingDate: "2026-06-01"
      }, postShipment);
      expect(posted.error).toBeNull();

      const shipment = await db
        .selectFrom("shipment")
        .select(["status", sql<string>`"postingDate"::text`.as("postingDate")])
        .where("id", "=", shipmentId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      expect(shipment).toEqual({ status: "Posted", postingDate: "2026-06-01" });

      const [ledger, journals] = await Promise.all([
        db
          .selectFrom("itemLedger")
          .select("id")
          .where("companyId", "=", companyId)
          .execute(),
        db
          .selectFrom("journalLine")
          .select("id")
          .where("companyId", "=", companyId)
          .execute()
      ]);
      expect(ledger).toEqual([]);
      expect(journals).toEqual([]);

      // Nothing left to deliver: the job built one and it is delivered.
      await expect(f.deliver(f.tmLineId)).rejects.toMatchObject({
        message: expect.stringContaining("Nothing to deliver")
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Fixed Price delivery moves its units' share of the billing event to the delivery date, and void moves it back",
  async () => {
    const f = await deliveryFixture();
    const { ctx } = f;
    try {
      expect(await f.schedule()).toEqual([["2026-12-31", 80_000]]);

      const shipmentId = await f.deliver(f.fixedLineId);
      const posted = await invokePosting(handlesOf(ctx), "post-shipment", {
        type: "post",
        shipmentId,
        postingDate: "2026-06-01"
      }, postShipment);
      expect(posted.error).toBeNull();
      expect(await f.schedule()).toEqual([
        ["2026-06-01", 40_000],
        ["2026-12-31", 40_000]
      ]);

      const voided = await invokePosting(handlesOf(ctx), "post-shipment", { type: "void", shipmentId }, postShipment);
      expect(voided.error).toBeNull();
      expect(await f.schedule()).toEqual([["2026-12-31", 80_000]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a delivery of the last units moves the whole billing row, and void returns it to its date",
  async () => {
    const f = await deliveryFixture();
    const { db, ctx, companyId } = f;
    try {
      await db
        .updateTable("job")
        .set({ quantityComplete: 2 })
        .where("customerContractLineId", "=", f.fixedLineId)
        .where("companyId", "=", companyId)
        .execute();
      const shipmentId = await f.deliver(f.fixedLineId);
      expect(
        (
          await invokePosting(handlesOf(ctx), "post-shipment", {
            type: "post",
            shipmentId,
            postingDate: "2026-06-01"
          }, postShipment)
        ).error
      ).toBeNull();
      expect(await f.schedule()).toEqual([["2026-06-01", 80_000]]);

      expect(
        (await invokePosting(handlesOf(ctx), "post-shipment", { type: "void", shipmentId }, postShipment)).error
      ).toBeNull();
      expect(await f.schedule()).toEqual([["2026-12-31", 80_000]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an amendment after a Fixed Price delivery leaves the delivered billing row in place",
  async () => {
    const f = await deliveryFixture();
    const { ctx } = f;
    try {
      const shipmentId = await f.deliver(f.fixedLineId);
      expect(
        (
          await invokePosting(handlesOf(ctx), "post-shipment", {
            type: "post",
            shipmentId,
            postingDate: "2026-06-01"
          }, postShipment)
        ).error
      ).toBeNull();

      const amendment = await invokePosting(handlesOf(ctx), "post-customer-contract", {
        type: "amend",
        customerContractId: f.contractId,
        asOf: "2026-06-15",
        amendmentDate: "2026-07-01",
        effect: "Change Date",
        contractType: "Expansion",
        reason: "Add a spare",
        changes: [
          {
            op: "add",
            line: {
              revenueType: "One-time",
              itemId: f.partId,
              quantity: 1,
              rate: 5_000,
              discountPercent: 0,
              taxPercent: 0,
              startDate: "2026-07-01",
              billingMethod: "Fixed",
              revenueMethod: "Daily"
            }
          }
        ]
      }, postCustomerContract);
      expect(amendment.error).toBeNull();
      expect(await f.schedule()).toEqual([
        ["2026-06-01", 40_000],
        ["2026-12-31", 40_000]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
