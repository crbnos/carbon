// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A contract's life against the live database: confirm → draft the first
// invoice → amend mid-period → draft the next → cancel with a credit → end.
// Runs both server functions (`post-customer-contract`,
// `create-contract-invoices`) through their real entry points on a scratch
// company that is deleted afterwards.

import type { KyselyDatabase } from "@carbon/database/client";
import { CONTRACT_HOLD_ADJUSTMENT, round } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { expect } from "vitest";
import createContractInvoices from "../create-contract-invoices";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import postCustomerContract, { type ContractCancellationResult } from "./index";

const USER = "system";

async function contractFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `contest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const customerId = `${prefix}-customer`;
  const itemId = `${prefix}-item`;
  const locationId = `${prefix}-location`;
  const contractId = `${prefix}-contract`;
  const shipToId = `${prefix}-ship-to`;
  const oneTimeLineId = `${prefix}-implementation`;
  const seatsLineId = `${prefix}-seats`;

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
      .values(
        [
          { table: "salesInvoice", name: "Sales Invoice", prefix: "INV-" },
          { table: "creditMemo", name: "Credit Memo", prefix: "CM-" }
        ].map((row) => ({ ...row, companyId }))
      )
      .execute();
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: prefix, companyId })
      .execute();
    await trx
      .insertInto("address")
      .values({
        id: `${prefix}-ship-to-address`,
        addressLine1: "9 Dock Rd",
        city: "Shelbyville",
        countryCode: "US",
        companyId
      })
      .execute();
    await trx
      .insertInto("customerLocation")
      .values({
        id: shipToId,
        name: "Warehouse",
        customerId,
        addressId: `${prefix}-ship-to-address`,
        companyId
      })
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
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${prefix}-SVC`,
        name: "Platform subscription",
        type: "Service",
        itemTrackingType: "Non-Inventory",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("customerContract")
      .values({
        id: contractId,
        customerContractId: "CON-TEST",
        name: "Acme platform",
        customerId,
        closeDate: "2026-10-01",
        startDate: "2026-11-01",
        endDate: "2027-10-31",
        termMonths: 12,
        billingFrequency: "Month",
        billingAlignment: "Calendar",
        billingTiming: "Advance",
        currencyCode: "USD",
        shipToCustomerLocationId: shipToId,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("customerContractLine")
      .values([
        {
          id: oneTimeLineId,
          customerContractId: contractId,
          revenueType: "One-time",
          itemId,
          description: "Implementation",
          quantity: 1,
          rate: 60_000,
          startDate: "2026-11-01",
          endDate: "2027-04-30",
          sortOrder: 1,
          companyId,
          createdBy: USER
        },
        {
          id: seatsLineId,
          customerContractId: contractId,
          revenueType: "Recurring",
          itemId,
          description: "Platform seats",
          quantity: 10,
          rate: 40,
          rateUnit: "Month",
          discountPercent: 0.2,
          startDate: "2026-11-01",
          sortOrder: 2,
          companyId,
          createdBy: USER
        }
      ])
      .execute();
  });

  const ctx = ServerFnContext.system({ db, companyId, userId: USER });

  return {
    db,
    ctx,
    companyId,
    contractId,
    shipToId,
    oneTimeLineId,
    seatsLineId,
    /** A Monthly / Calendar / Advance contract with one Recurring line,
     *  1 × 100 / Month, running from the contract's start. */
    async addRecurringContract(input: {
      key: string;
      startDate: string;
      endDate: string | null;
      termMonths?: number;
      renewal?: "Renew" | "End";
      renewalUplift?: number;
    }) {
      const id = `${prefix}-${input.key}`;
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("customerContract")
          .values({
            id,
            customerContractId: `CON-${input.key}`,
            name: input.key,
            customerId,
            closeDate: input.startDate,
            startDate: input.startDate,
            endDate: input.endDate,
            termMonths: input.termMonths ?? null,
            renewal: input.renewal ?? "End",
            renewalUplift: input.renewalUplift ?? 0,
            billingFrequency: "Month",
            billingAlignment: "Calendar",
            billingTiming: "Advance",
            currencyCode: "USD",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("customerContractLine")
          .values({
            id: `${id}-line`,
            customerContractId: id,
            revenueType: "Recurring",
            itemId,
            quantity: 1,
            rate: 100,
            rateUnit: "Month",
            startDate: input.startDate,
            companyId,
            createdBy: USER
          })
          .execute();
      });
      return { contractId: id, lineId: `${id}-line` };
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

async function plannedInvoices(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  contractId: string
) {
  const invoices = await db
    .selectFrom("customerContractInvoice")
    .select([
      "id",
      sql<string>`"invoiceDate"::text`.as("invoiceDate"),
      "status",
      "salesInvoiceId"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("invoiceDate")
    .execute();
  const rows = await db
    .selectFrom("customerContractInvoiceLine")
    .select([
      "id",
      "customerContractInvoiceId",
      "customerContractLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      "unitPrice",
      "amount",
      "isAdjustment",
      "salesInvoiceLineId",
      "memoId"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("periodStart")
    .execute();
  return invoices.map((invoice) => {
    const own = rows.filter(
      (row) => row.customerContractInvoiceId === invoice.id
    );
    return {
      ...invoice,
      rows: own,
      total: own.reduce((sum, row) => sum + Number(row.amount), 0)
    };
  });
}

async function invoiceLines(db: Kysely<KyselyDatabase>, invoiceId: string) {
  return db
    .selectFrom("salesInvoiceLine")
    .select([
      "invoiceLineType",
      "description",
      "quantity",
      "unitPrice",
      "discountPercent",
      sql<string | null>`"serviceStartDate"::text`.as("serviceStartDate"),
      sql<string | null>`"serviceEndDate"::text`.as("serviceEndDate"),
      "customerContractId",
      "customerContractLineId",
      "customerContractInvoiceLineId",
      "locationId"
    ])
    .where("invoiceId", "=", invoiceId)
    .orderBy("sortOrder")
    .execute();
}

databaseTest(
  "a contract confirms, drafts its invoices once, reconciles an amendment and credits a cancellation",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId, contractId } = f;
    try {
      // --- Confirm -----------------------------------------------------------
      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-10-15"
      });
      expect(confirmed.error).toBeNull();
      const contract = await db
        .selectFrom("customerContract")
        .select(["status"])
        .where("id", "=", contractId)
        .executeTakeFirstOrThrow();
      expect(contract.status).toEqual("Active");

      let schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule).toHaveLength(12);
      expect(schedule[0]!.invoiceDate).toEqual("2026-11-01");
      expect(schedule[0]!.status).toEqual("Planned");
      expect(schedule[0]!.total).toBeCloseTo(60_320, 5);
      expect(schedule[1]!.total).toBeCloseTo(320, 5);

      // --- Draft the 1 Nov invoice -----------------------------------------
      const first = await createContractInvoices(ctx, { asOf: "2026-11-01" });
      expect(first.error).toBeNull();
      expect(first.data!.failures).toEqual([]);
      expect(first.data!.invoices).toHaveLength(1);
      expect(first.data!.invoices[0]).toMatchObject({
        customerContractId: contractId,
        // The company default (no override on the contract).
        mode: "Post and Email",
        holdReason: null
      });
      const novemberId = first.data!.invoiceIds[0]!;

      const november = await db
        .selectFrom("salesInvoice")
        .select([
          "status",
          "customerContractId",
          "subtotal",
          "totalTax",
          "totalAmount",
          "locationId",
          sql<string>`"dateIssued"::text`.as("dateIssued")
        ])
        .where("id", "=", novemberId)
        .executeTakeFirstOrThrow();
      expect(november).toMatchObject({
        status: "Draft",
        customerContractId: contractId,
        totalTax: 0,
        dateIssued: "2026-11-01"
      });
      expect(Number(november.subtotal)).toBeCloseTo(60_320, 5);
      expect(Number(november.totalAmount)).toBeCloseTo(60_320, 5);

      // The contract's ship-to is the drafted invoice's customer ship-to.
      const novemberShipment = await db
        .selectFrom("salesInvoiceShipment")
        .select(["customerLocationId"])
        .where("id", "=", novemberId)
        .executeTakeFirstOrThrow();
      expect(novemberShipment.customerLocationId).toEqual(f.shipToId);

      const novemberLines = await invoiceLines(db, novemberId);
      expect(novemberLines).toHaveLength(2);
      expect(novemberLines.every((l) => l.invoiceLineType === "Service")).toBe(
        true
      );
      const implementation = novemberLines.find(
        (l) => l.customerContractLineId === f.oneTimeLineId
      )!;
      expect(implementation).toMatchObject({
        quantity: 1,
        unitPrice: 60_000,
        discountPercent: 0,
        serviceStartDate: "2026-11-01",
        serviceEndDate: "2027-04-30",
        customerContractId: contractId
      });
      const seats = novemberLines.find(
        (l) => l.customerContractLineId === f.seatsLineId
      )!;
      expect(seats).toMatchObject({
        quantity: 10,
        unitPrice: 40,
        discountPercent: 0.2,
        serviceStartDate: "2026-11-01",
        serviceEndDate: "2026-11-30"
      });
      expect(seats.description).toContain("Platform seats · Nov 1, 2026");

      schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule[0]!.status).toEqual("Invoiced");
      expect(schedule[0]!.salesInvoiceId).toEqual(novemberId);
      expect(schedule[0]!.rows.every((row) => row.salesInvoiceLineId)).toBe(
        true
      );

      // Re-running the same day drafts nothing.
      const again = await createContractInvoices(ctx, { asOf: "2026-11-01" });
      expect(again.error).toBeNull();
      expect(again.data!.invoices).toHaveLength(0);
      expect(again.data!.failures).toEqual([]);

      // --- Amend: 10 → 15 seats from 12 Nov --------------------------------
      const amended = await postCustomerContract(ctx, {
        type: "amend",
        customerContractId: contractId,
        asOf: "2026-11-12",
        amendmentDate: "2026-11-12",
        effect: "Change Date",
        contractType: "Expansion",
        reason: "Five more seats",
        changes: [{ op: "change", lineId: f.seatsLineId, quantity: 15 }]
      });
      expect(amended.error).toBeNull();

      schedule = await plannedInvoices(db, companyId, contractId);
      const december = schedule.find((i) => i.status === "Planned")!;
      expect(december.invoiceDate).toEqual("2026-12-01");
      const adjustment = december.rows.find((row) => row.isAdjustment)!;
      expect(adjustment.customerContractLineId).toEqual(f.seatsLineId);
      expect(adjustment.periodStart).toEqual("2026-11-12");
      expect(adjustment.periodEnd).toEqual("2026-11-30");
      expect(Number(adjustment.amount)).toBeCloseTo(-((320 * 19) / 30), 4);
      const stub = december.rows.find(
        (row) => !row.isAdjustment && row.periodStart === "2026-11-12"
      )!;
      expect(stub.periodEnd).toEqual("2026-11-30");
      // 15 seats × round(40 × 19/30) × 0.8
      expect(Number(stub.amount)).toBeCloseTo(15 * 25.33333 * 0.8, 4);
      const decemberSeats = december.rows.find(
        (row) => !row.isAdjustment && row.periodStart === "2026-12-01"
      )!;
      expect(Number(decemberSeats.amount)).toBeCloseTo(480, 5);

      // --- Draft the 1 Dec invoice -----------------------------------------
      const second = await createContractInvoices(ctx, { asOf: "2026-12-01" });
      expect(second.error).toBeNull();
      expect(second.data!.failures).toEqual([]);
      expect(second.data!.invoices).toHaveLength(1);
      // The credit row holds the draft for review under automation.
      expect(second.data!.invoices[0]!.holdReason).toEqual(
        CONTRACT_HOLD_ADJUSTMENT
      );
      const decemberLines = await invoiceLines(db, second.data!.invoiceIds[0]!);
      expect(decemberLines).toHaveLength(3);
      const credit = decemberLines.find(
        (l) => l.customerContractInvoiceLineId === adjustment.id
      )!;
      // An adjustment no longer equals quantity × price × (1 − discount):
      // one unit at its amount, the discount stated in the description.
      expect(credit.quantity).toEqual(1);
      expect(Number(credit.unitPrice)).toBeCloseTo(-((320 * 19) / 30), 4);
      expect(credit.discountPercent).toEqual(0);
      expect(credit.description).toContain("20% off");
      const stubLine = decemberLines.find(
        (l) => l.customerContractInvoiceLineId === stub.id
      )!;
      expect(stubLine).toMatchObject({
        quantity: 15,
        discountPercent: 0.2,
        serviceStartDate: "2026-11-12",
        serviceEndDate: "2026-11-30"
      });

      // --- Cancel on 15 Dec, crediting unused time --------------------------
      const cancelled = await postCustomerContract(ctx, {
        type: "cancel",
        customerContractId: contractId,
        asOf: "2026-12-10",
        endDate: "2026-12-15",
        reason: "Customer is consolidating vendors",
        creditUnusedTime: true
      });
      expect(cancelled.error).toBeNull();
      // The return type is a union of every action's result.
      const result = cancelled.data as unknown as ContractCancellationResult;
      expect(result.memoId).not.toBeNull();
      const memo = await db
        .selectFrom("memo")
        .select(["status", "direction", "amount", "customerContractId"])
        .where("id", "=", result.memoId!)
        .executeTakeFirstOrThrow();
      // 15 seats × 40 × 0.8 = 480 for December, 16 of 31 days unused.
      expect(memo).toMatchObject({
        status: "Draft",
        direction: "Credit",
        customerContractId: contractId
      });
      expect(Number(memo.amount)).toBeCloseTo(247.74, 2);
      // Exactly 480 × 16/31 = 247.74194: the memo-borne rows are apportioned
      // to cents so they sum to the memo — posting the memo refuses rows that
      // credit more than its amount.
      const memoRows = await db
        .selectFrom("customerContractInvoiceLine")
        .select(["amount"])
        .where("memoId", "=", result.memoId!)
        .where("companyId", "=", companyId)
        .execute();
      expect(memoRows.length).toBeGreaterThan(0);
      expect(
        memoRows.reduce((sum, row) => sum + Number(row.amount), 0)
      ).toBeCloseTo(-Number(memo.amount), 6);
      expect(
        memoRows.every(
          (row) => Number(row.amount) === round(Number(row.amount), 2)
        )
      ).toBe(true);
      schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule.filter((i) => i.status === "Planned")).toHaveLength(0);

      // --- After the end date the contract ends ----------------------------
      const after = await createContractInvoices(ctx, { asOf: "2026-12-16" });
      expect(after.error).toBeNull();
      expect(after.data!.invoices).toHaveLength(0);
      expect(after.data!.failures).toEqual([]);
      const ended = await db
        .selectFrom("customerContract")
        .select(["status", "endedAt"])
        .where("id", "=", contractId)
        .executeTakeFirstOrThrow();
      expect(ended.status).toEqual("Ended");
      expect(ended.endedAt).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a due renewal carries its lines into the next term at the uplifted rate, and an open-ended schedule rolls forward",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      // A three-month term that renews with a 10% uplift.
      const renewing = await f.addRecurringContract({
        key: "renewing",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        termMonths: 3,
        renewal: "Renew",
        renewalUplift: 0.1
      });
      // An open-ended contract: planned only to the horizon.
      const open = await f.addRecurringContract({
        key: "open",
        startDate: "2026-01-01",
        endDate: null
      });
      for (const { contractId } of [renewing, open]) {
        const confirmed = await postCustomerContract(ctx, {
          type: "confirm",
          customerContractId: contractId,
          asOf: "2026-01-01"
        });
        expect(confirmed.error).toBeNull();
      }
      expect(
        (await plannedInvoices(db, companyId, open.contractId)).map(
          (i) => i.invoiceDate
        )
      ).toEqual(["2026-01-01", "2026-02-01"]);

      const run = await createContractInvoices(ctx, { asOf: "2026-04-01" });
      expect(run.error).toBeNull();
      expect(run.data!.failures).toEqual([]);

      // Renewal: one term later, the line ended and copied at 110.
      const contract = await db
        .selectFrom("customerContract")
        .select([sql<string>`"endDate"::text`.as("endDate"), "status"])
        .where("id", "=", renewing.contractId)
        .executeTakeFirstOrThrow();
      expect(contract).toEqual({ endDate: "2026-06-30", status: "Active" });
      const lines = await db
        .selectFrom("customerContractLine")
        .select([
          "id",
          "rate",
          sql<string>`"startDate"::text`.as("startDate"),
          sql<string | null>`"endDate"::text`.as("endDate"),
          "amendsLineId",
          "amendmentId"
        ])
        .where("customerContractId", "=", renewing.contractId)
        .orderBy("startDate")
        .execute();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ rate: 100, endDate: "2026-03-31" });
      expect(lines[1]).toMatchObject({
        rate: 110,
        startDate: "2026-04-01",
        endDate: null,
        amendsLineId: renewing.lineId
      });
      const amendment = await db
        .selectFrom("customerContractAmendment")
        .select([
          "id",
          "reason",
          "effect",
          sql<string>`"amendmentDate"::text`.as("amendmentDate")
        ])
        .where("customerContractId", "=", renewing.contractId)
        .executeTakeFirstOrThrow();
      expect(amendment).toMatchObject({
        id: lines[1]!.amendmentId,
        reason: "Renewal",
        effect: "Next Period",
        amendmentDate: "2026-04-01"
      });
      const renewedSchedule = await plannedInvoices(
        db,
        companyId,
        renewing.contractId
      );
      expect(
        renewedSchedule.map((i) => [i.invoiceDate, i.status, i.total])
      ).toEqual([
        ["2026-01-01", "Invoiced", 100],
        ["2026-02-01", "Invoiced", 100],
        ["2026-03-01", "Invoiced", 100],
        ["2026-04-01", "Invoiced", 110],
        ["2026-05-01", "Planned", 110],
        ["2026-06-01", "Planned", 110]
      ]);

      // Horizon roll: March and April planned; January to March drafted.
      const openSchedule = await plannedInvoices(
        db,
        companyId,
        open.contractId
      );
      expect(openSchedule.map((i) => [i.invoiceDate, i.status])).toEqual([
        ["2026-01-01", "Invoiced"],
        ["2026-02-01", "Invoiced"],
        ["2026-03-01", "Invoiced"],
        ["2026-04-01", "Invoiced"],
        ["2026-05-01", "Planned"]
      ]);

      // Four renewing invoices (January to April) and four open-ended ones.
      expect(run.data!.invoices).toHaveLength(8);

      // A second run the same day is a no-op.
      const again = await createContractInvoices(ctx, { asOf: "2026-04-01" });
      expect(again.data!.invoices).toHaveLength(0);
      expect(again.data!.failures).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the first schedule edit of an unedited Draft names its row by position and materializes the schedule",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "split",
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      });
      // Nothing is persisted yet: the page names the January row by position.
      expect(await plannedInvoices(db, companyId, contractId)).toEqual([]);

      const split = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "split",
          customerContractInvoiceLineId: `planned:2026-01-01:${lineId}:2026-01-01`,
          installments: [
            { invoiceDate: "2026-01-01", amount: 60 },
            { invoiceDate: "2026-01-15", amount: 40 }
          ]
        }
      });
      expect(split.error).toBeNull();

      const schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule.map((i) => [i.invoiceDate, i.total])).toEqual([
        ["2026-01-01", 60],
        ["2026-01-15", 40],
        ["2026-02-01", 100],
        ["2026-03-01", 100]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a foreign-currency contract drafts its invoice lines in base currency at the contract's rate",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId } = await f.addRecurringContract({
        key: "eur",
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      });
      // EUR per 1 base unit, as `exchangeRate` is stored everywhere.
      await db
        .updateTable("customerContract")
        .set({ currencyCode: "EUR", exchangeRate: 0.9215 })
        .where("id", "=", contractId)
        .where("companyId", "=", companyId)
        .execute();

      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(confirmed.error).toBeNull();
      const run = await createContractInvoices(ctx, {
        asOf: "2026-01-01",
        customerContractId: contractId
      });
      expect(run.error).toBeNull();
      const invoiceId = run.data!.invoiceIds[0]!;

      const line = await db
        .selectFrom("salesInvoiceLine")
        .select(["unitPrice", "convertedUnitPrice", "exchangeRate"])
        .where("invoiceId", "=", invoiceId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      // The contract bills €100 a month: base = 100 / 0.9215, and the
      // customer-facing converted price is back to €100.
      expect(Number(line.unitPrice)).toBeCloseTo(100 / 0.9215, 4);
      expect(Number(line.convertedUnitPrice)).toBeCloseTo(100, 2);
      expect(Number(line.exchangeRate)).toBeCloseTo(0.9215, 5);
    } finally {
      await f.cleanup();
    }
  }
);

/** Contract lines, oldest first, with their dates as text. */
async function contractLines(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  contractId: string
) {
  return db
    .selectFrom("customerContractLine")
    .select([
      "id",
      "revenueType",
      "rate",
      "discountPercent",
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string | null>`"endDate"::text`.as("endDate"),
      sql<string | null>`"discountEndsOn"::text`.as("discountEndsOn"),
      "amendsLineId"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("startDate")
    .orderBy("createdAt")
    .execute();
}

async function addOneTimeLine(
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    contractId: string;
    itemId: string;
    rate: number;
    startDate: string;
    endDate: string;
  }
) {
  const id = `${input.contractId}-one-time`;
  await db
    .insertInto("customerContractLine")
    .values({
      id,
      customerContractId: input.contractId,
      revenueType: "One-time",
      itemId: input.itemId,
      quantity: 1,
      rate: input.rate,
      startDate: input.startDate,
      endDate: input.endDate,
      companyId: input.companyId,
      createdBy: USER
    })
    .execute();
  return id;
}

async function contractItemId(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  lineId: string
) {
  const line = await db
    .selectFrom("customerContractLine")
    .select("itemId")
    .where("id", "=", lineId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  return line.itemId;
}

databaseTest(
  "an open-ended contract with a year-long one-time line confirms its edited schedule and rolls its months forward",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "long-one-time",
        startDate: "2026-01-01",
        endDate: null
      });
      const oneTimeId = await addOneTimeLine(db, {
        companyId,
        contractId,
        itemId: await contractItemId(db, companyId, lineId),
        rate: 5000,
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });

      // Edit the Draft (materializes through the horizon, end of February).
      const split = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "split",
          customerContractInvoiceLineId: `planned:2026-01-01:${oneTimeId}:2026-01-01`,
          installments: [
            { invoiceDate: "2026-01-01", amount: 3000 },
            { invoiceDate: "2026-02-01", amount: 2000 }
          ]
        }
      });
      expect(split.error).toBeNull();

      // The one-time line's service window runs to December; the edited
      // schedule is still compared over the months it plans.
      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(confirmed.error).toBeNull();

      const run = await createContractInvoices(ctx, {
        asOf: "2026-04-01",
        customerContractId: contractId
      });
      expect(run.error).toBeNull();
      expect(run.data!.failures).toEqual([]);

      const schedule = await plannedInvoices(db, companyId, contractId);
      const monthly = schedule
        .flatMap((invoice) => invoice.rows)
        .filter((row) => row.customerContractLineId === lineId)
        .map((row) => row.periodStart);
      expect(monthly).toEqual([
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01"
      ]);
      expect(schedule.map((i) => [i.invoiceDate, i.status])).toEqual([
        ["2026-01-01", "Invoiced"],
        ["2026-02-01", "Invoiced"],
        ["2026-03-01", "Invoiced"],
        ["2026-04-01", "Invoiced"],
        ["2026-05-01", "Planned"]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a cancellation cannot be reverted once the contract was amended after it",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const amended = await f.addRecurringContract({
        key: "revert-amended",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });
      const plain = await f.addRecurringContract({
        key: "revert-plain",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });
      for (const { contractId } of [amended, plain]) {
        expect(
          (
            await postCustomerContract(ctx, {
              type: "confirm",
              customerContractId: contractId,
              asOf: "2026-01-01"
            })
          ).error
        ).toBeNull();
        expect(
          (
            await postCustomerContract(ctx, {
              type: "cancel",
              customerContractId: contractId,
              asOf: "2026-03-10",
              endDate: "2026-03-31",
              reason: "Budget cut",
              creditUnusedTime: false
            })
          ).error
        ).toBeNull();
      }

      // An amendment after the cancellation (its reason even reads like one).
      const change = await postCustomerContract(ctx, {
        type: "amend",
        customerContractId: amended.contractId,
        asOf: "2026-03-10",
        amendmentDate: "2026-03-15",
        effect: "Change Date",
        contractType: "Expansion",
        reason: "Cancellation of the discount",
        changes: [{ op: "change", lineId: amended.lineId, quantity: 2 }]
      });
      expect(change.error).toBeNull();

      const refused = await postCustomerContract(ctx, {
        type: "revert-cancellation",
        customerContractId: amended.contractId,
        asOf: "2026-03-12"
      });
      expect(refused.error?.message).toContain("amended after");
      const stillCancelled = await db
        .selectFrom("customerContract")
        .select(sql<string>`"endDate"::text`.as("endDate"))
        .where("id", "=", amended.contractId)
        .executeTakeFirstOrThrow();
      expect(stillCancelled.endDate).toEqual("2026-03-31");

      // With no later amendment the revert restores the line and the end.
      const reverted = await postCustomerContract(ctx, {
        type: "revert-cancellation",
        customerContractId: plain.contractId,
        asOf: "2026-03-12"
      });
      expect(reverted.error).toBeNull();
      const lines = await contractLines(db, companyId, plain.contractId);
      expect(lines.map((l) => l.endDate)).toEqual([null]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a discount that ends is split off a line added by an amendment and off a renewed line",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      // --- Amend: add a half-price line whose discount ends 30 June ---------
      const added = await f.addRecurringContract({
        key: "discount-add",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });
      expect(
        (
          await postCustomerContract(ctx, {
            type: "confirm",
            customerContractId: added.contractId,
            asOf: "2026-01-01"
          })
        ).error
      ).toBeNull();
      const amendment = await postCustomerContract(ctx, {
        type: "amend",
        customerContractId: added.contractId,
        asOf: "2026-03-15",
        amendmentDate: "2026-04-01",
        effect: "Change Date",
        contractType: "Expansion",
        reason: "Add support",
        changes: [
          {
            op: "add",
            line: {
              revenueType: "Recurring",
              itemId: await contractItemId(db, companyId, added.lineId),
              quantity: 1,
              rate: 100,
              rateUnit: "Month",
              discountPercent: 50,
              discountEndsOn: "2026-06-30",
              taxPercent: 0,
              startDate: "2026-04-01",
              revenueMethod: "Daily"
            }
          }
        ]
      });
      expect(amendment.error).toBeNull();
      const addedLines = (
        await contractLines(db, companyId, added.contractId)
      ).filter((line) => line.id !== added.lineId);
      expect(
        addedLines.map((l) => [
          l.startDate,
          l.endDate,
          Number(l.discountPercent)
        ])
      ).toEqual([
        ["2026-04-01", "2026-06-30", 0.5],
        ["2026-07-01", null, 0]
      ]);
      const addedSchedule = await plannedInvoices(
        db,
        companyId,
        added.contractId
      );
      const total = (date: string) =>
        addedSchedule.find((i) => i.invoiceDate === date)?.total;
      expect(total("2026-06-01")).toBeCloseTo(150, 5);
      expect(total("2026-07-01")).toBeCloseTo(200, 5);

      // --- Renewal: a discount running past the term ends in the next one ---
      const renewing = await f.addRecurringContract({
        key: "discount-renew",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        termMonths: 3,
        renewal: "Renew"
      });
      await db
        .updateTable("customerContractLine")
        .set({ discountPercent: 0.5, discountEndsOn: "2026-04-30" })
        .where("id", "=", renewing.lineId)
        .where("companyId", "=", companyId)
        .execute();
      expect(
        (
          await postCustomerContract(ctx, {
            type: "confirm",
            customerContractId: renewing.contractId,
            asOf: "2026-01-01"
          })
        ).error
      ).toBeNull();
      const run = await createContractInvoices(ctx, {
        asOf: "2026-04-01",
        customerContractId: renewing.contractId
      });
      expect(run.error).toBeNull();
      expect(run.data!.failures).toEqual([]);
      const renewed = await plannedInvoices(db, companyId, renewing.contractId);
      expect(renewed.map((i) => [i.invoiceDate, i.total])).toEqual([
        ["2026-01-01", 50],
        ["2026-02-01", 50],
        ["2026-03-01", 50],
        ["2026-04-01", 50],
        ["2026-05-01", 100],
        ["2026-06-01", 100]
      ]);

      // --- Renewal with an uplift: a discount that ended with the old term
      // is not carried into the copy as a discount that never ends ---------
      const uplifted = await f.addRecurringContract({
        key: "discount-uplift",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        termMonths: 3,
        renewal: "Renew",
        renewalUplift: 0.1
      });
      await db
        .updateTable("customerContractLine")
        .set({ discountPercent: 0.5, discountEndsOn: "2026-03-31" })
        .where("id", "=", uplifted.lineId)
        .where("companyId", "=", companyId)
        .execute();
      expect(
        (
          await postCustomerContract(ctx, {
            type: "confirm",
            customerContractId: uplifted.contractId,
            asOf: "2026-01-01"
          })
        ).error
      ).toBeNull();
      const upliftRun = await createContractInvoices(ctx, {
        asOf: "2026-04-01",
        customerContractId: uplifted.contractId
      });
      expect(upliftRun.error).toBeNull();
      expect(upliftRun.data!.failures).toEqual([]);
      const copy = (
        await contractLines(db, companyId, uplifted.contractId)
      ).find((line) => line.id !== uplifted.lineId)!;
      expect([Number(copy.discountPercent), copy.discountEndsOn]).toEqual([
        0,
        null
      ]);
      const upliftedSchedule = await plannedInvoices(
        db,
        companyId,
        uplifted.contractId
      );
      expect(upliftedSchedule.map((i) => [i.invoiceDate, i.total])).toEqual([
        ["2026-01-01", 50],
        ["2026-02-01", 50],
        ["2026-03-01", 50],
        ["2026-04-01", 110],
        ["2026-05-01", 110],
        ["2026-06-01", 110]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "amend and confirm refuse what the database would, with a message",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      // --- A split installment of nothing is refused ----------------------
      const draft = await f.addRecurringContract({
        key: "zero-split",
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      });
      const zero = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: draft.contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "split",
          customerContractInvoiceLineId: `planned:2026-01-01:${draft.lineId}:2026-01-01`,
          installments: [
            { invoiceDate: "2026-01-01", amount: 100 },
            { invoiceDate: "2026-01-15", amount: 0 }
          ]
        }
      });
      expect(zero.error).not.toBeNull();

      // --- Billed through must fall on a period end ------------------------
      await db
        .updateTable("customerContract")
        .set({ billedThrough: "2026-02-15" })
        .where("id", "=", draft.contractId)
        .where("companyId", "=", companyId)
        .execute();
      const offGrid = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: draft.contractId,
        asOf: "2026-01-01"
      });
      expect(offGrid.error?.message).toContain("2026-02-28");
      await db
        .updateTable("customerContract")
        .set({ billedThrough: "2026-01-31" })
        .where("id", "=", draft.contractId)
        .where("companyId", "=", companyId)
        .execute();
      expect(
        (
          await postCustomerContract(ctx, {
            type: "confirm",
            customerContractId: draft.contractId,
            asOf: "2026-01-01"
          })
        ).error
      ).toBeNull();

      // --- Amend: percent points, a rate unit on a one-time line, an end
      // before the effective date ------------------------------------------
      const active = await f.addRecurringContract({
        key: "amend-checks",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });
      const itemId = await contractItemId(db, companyId, active.lineId);
      const oneTimeId = await addOneTimeLine(db, {
        companyId,
        contractId: active.contractId,
        itemId,
        rate: 500,
        startDate: "2026-06-01",
        endDate: "2026-06-30"
      });
      expect(
        (
          await postCustomerContract(ctx, {
            type: "confirm",
            customerContractId: active.contractId,
            asOf: "2026-01-01"
          })
        ).error
      ).toBeNull();
      const amend = (
        changes: Parameters<typeof postCustomerContract>[1] extends infer I
          ? I extends { type: "amend"; changes: infer C }
            ? C
            : never
          : never
      ) =>
        postCustomerContract(ctx, {
          type: "amend",
          customerContractId: active.contractId,
          asOf: "2026-03-10",
          amendmentDate: "2026-04-01",
          effect: "Change Date",
          contractType: "Existing",
          reason: "Checks",
          changes
        });

      const rateUnit = await amend([
        { op: "change", lineId: oneTimeId, rateUnit: "Month" }
      ]);
      expect(rateUnit.error?.message).toContain("one-time");

      const endsEarly = await amend([
        {
          op: "add",
          line: {
            revenueType: "Recurring",
            itemId,
            quantity: 1,
            rate: 10,
            rateUnit: "Month",
            discountPercent: 0,
            taxPercent: 0,
            startDate: "2026-02-01",
            endDate: "2026-03-15",
            revenueMethod: "Daily"
          }
        }
      ]);
      expect(endsEarly.error?.message).toContain("2026-03-15");

      const percent = await amend([
        { op: "change", lineId: active.lineId, discountPercent: 14.3 }
      ]);
      expect(percent.error).toBeNull();
      const replacement = (
        await contractLines(db, companyId, active.contractId)
      ).find((line) => line.amendsLineId === active.lineId)!;
      expect(Number(replacement.discountPercent)).toBe(0.143);
    } finally {
      await f.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// Phase B: invoice-grid and revenue-grid edits, revenue at confirm and on
// lifecycle changes (.ai/plans/2026-10-04-contracts-wizard-phase-b.md T3).

/** The contract's stored revenue rows, in line and month order. */
async function revenueRows(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  contractId: string
) {
  const rows = await db
    .selectFrom("customerContractRevenue")
    .select([
      "customerContractLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      "amount",
      "status"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("customerContractLineId")
    .orderBy("periodStart")
    .execute();
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

async function setEvenPeriodRevenue(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  lineId: string
) {
  await db
    .updateTable("customerContractLine")
    .set({ revenueMethod: "Even Period" })
    .where("id", "=", lineId)
    .where("companyId", "=", companyId)
    .execute();
}

/** The structured body of a refused call. */
const errorBody = (result: { error: unknown }) =>
  (result.error as { body?: Record<string, unknown> } | null)?.body ?? {};

databaseTest(
  "an invoice-grid amount set from the computed state leaves a residual that an added invoice restores",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "grid-set",
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      });
      expect(await plannedInvoices(db, companyId, contractId)).toEqual([]);

      // The page names the February invoice by position.
      const set = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "setAmount",
          customerContractInvoiceId: "planned:2026-02-01",
          customerContractLineId: lineId,
          amount: 60
        }
      });
      expect(set.error).toBeNull();
      let schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule.map((i) => [i.invoiceDate, i.total])).toEqual([
        ["2026-01-01", 100],
        ["2026-02-01", 60],
        ["2026-03-01", 100]
      ]);
      const february = await db
        .selectFrom("customerContractInvoiceLine as r")
        .innerJoin(
          "customerContractInvoice as i",
          "i.id",
          "r.customerContractInvoiceId"
        )
        .select(["r.units", "r.unitPrice", "i.isEdited"])
        .where("r.customerContractId", "=", contractId)
        .where("i.invoiceDate", "=", "2026-02-01")
        .executeTakeFirstOrThrow();
      // Rescaled like a split: 60 of a 100 month is 0.6 of its unit.
      expect(Number(february.units)).toBeCloseTo(0.6, 5);
      expect(Number(february.unitPrice)).toBe(100);
      expect(february.isEdited).toBe(true);

      // 40 is on no invoice: Confirm refuses.
      const refused = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(refused.error).not.toBeNull();
      expect(errorBody(refused).residuals).toEqual({ [lineId]: 40 });

      // An invoice prefilled with the residual restores the balance.
      const added = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "addInvoice",
          invoiceDate: "2026-02-15",
          amounts: [{ customerContractLineId: lineId, amount: 40 }]
        }
      });
      expect(added.error).toBeNull();
      schedule = await plannedInvoices(db, companyId, contractId);
      const mid = schedule.find((i) => i.invoiceDate === "2026-02-15")!;
      expect(mid.total).toBe(40);
      // The nearest planned period of the line (1 Feb and 1 Mar are both two
      // weeks away; the earlier wins).
      expect([mid.rows[0]!.periodStart, mid.rows[0]!.periodEnd]).toEqual([
        "2026-02-01",
        "2026-02-28"
      ]);

      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(confirmed.error).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "deleting a planned invoice leaves a residual; an invoice added on a taken date adds to its cell",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "grid-delete",
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      });
      const deleted = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "delete",
          customerContractInvoiceId: "planned:2026-03-01"
        }
      });
      expect(deleted.error).toBeNull();
      let schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule.map((i) => [i.invoiceDate, i.total])).toEqual([
        ["2026-01-01", 100],
        ["2026-02-01", 100]
      ]);
      const refused = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(errorBody(refused).residuals).toEqual({ [lineId]: 100 });

      const added = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "addInvoice",
          invoiceDate: "2026-02-01",
          amounts: [{ customerContractLineId: lineId, amount: 100 }]
        }
      });
      expect(added.error).toBeNull();
      schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule.map((i) => [i.invoiceDate, i.total])).toEqual([
        ["2026-01-01", 100],
        ["2026-02-01", 200]
      ]);
      // One row per cell.
      expect(schedule[1]!.rows).toHaveLength(1);

      // An amount of 0 removes the cell; the invoice left empty goes too.
      const cleared = await postCustomerContract(ctx, {
        type: "edit-schedule",
        customerContractId: contractId,
        asOf: "2026-01-01",
        edit: {
          intent: "setAmount",
          customerContractInvoiceId: schedule[1]!.id,
          customerContractLineId: lineId,
          amount: 0
        }
      });
      expect(cleared.error).toBeNull();
      schedule = await plannedInvoices(db, companyId, contractId);
      expect(schedule.map((i) => i.invoiceDate)).toEqual(["2026-01-01"]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a revenue edit from the computed state writes the plan, and confirm refuses a revenue residual",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "revenue-edit",
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      });
      await setEvenPeriodRevenue(db, companyId, lineId);
      const editRevenue = (
        edit: Extract<
          Parameters<typeof postCustomerContract>[1],
          { type: "edit-revenue" }
        >["edit"]
      ) =>
        postCustomerContract(ctx, {
          type: "edit-revenue",
          customerContractId: contractId,
          asOf: "2026-01-01",
          edit
        });

      const set = await editRevenue({
        intent: "setAmount",
        customerContractLineId: lineId,
        periodStart: "2026-02-01",
        amount: 50
      });
      expect(set.error).toBeNull();
      expect(
        (await revenueRows(db, companyId, contractId)).map((row) => [
          row.periodStart,
          row.periodEnd,
          row.amount,
          row.status
        ])
      ).toEqual([
        ["2026-01-01", "2026-01-31", 100, "Planned"],
        ["2026-02-01", "2026-02-28", 50, "Planned"],
        ["2026-03-01", "2026-03-31", 100, "Planned"]
      ]);
      // Only the revenue plan was written; the invoice schedule stays live.
      expect(await plannedInvoices(db, companyId, contractId)).toEqual([]);

      // A month that is not the 1st, or a line of another contract, is refused.
      expect(
        (
          await editRevenue({
            intent: "setAmount",
            customerContractLineId: f.seatsLineId,
            periodStart: "2026-02-01",
            amount: 1
          })
        ).error
      ).not.toBeNull();

      const refused = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(refused.error).not.toBeNull();
      expect(errorBody(refused).revenueResiduals).toEqual({ [lineId]: 50 });

      // Reset goes back to the live plan; delete a month, then add it back.
      expect((await editRevenue({ intent: "reset" })).error).toBeNull();
      expect(await revenueRows(db, companyId, contractId)).toEqual([]);
      expect(
        (
          await editRevenue({
            intent: "deleteMonth",
            periodStart: "2026-03-01"
          })
        ).error
      ).toBeNull();
      expect(
        (await revenueRows(db, companyId, contractId)).map((r) => r.periodStart)
      ).toEqual(["2026-01-01", "2026-02-01"]);
      expect(
        (
          await editRevenue({
            intent: "addMonth",
            periodStart: "2026-04-01",
            amounts: [{ customerContractLineId: lineId, amount: 100 }]
          })
        ).error
      ).toBeNull();

      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(confirmed.error).toBeNull();
      expect(
        (await revenueRows(db, companyId, contractId)).map((r) => [
          r.periodStart,
          r.amount
        ])
      ).toEqual([
        ["2026-01-01", 100],
        ["2026-02-01", 100],
        ["2026-04-01", 100]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "confirm writes the revenue plan and an Opening entry for a migrated contract",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "migrated",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });
      await setEvenPeriodRevenue(db, companyId, lineId);
      // Billed elsewhere through March; recognized elsewhere through February.
      await db
        .updateTable("customerContract")
        .set({
          billedThrough: "2026-03-31",
          recognizeRevenueFrom: "2026-03-01",
          exchangeRate: 0.8
        })
        .where("id", "=", contractId)
        .where("companyId", "=", companyId)
        .execute();

      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-04-01"
      });
      expect(confirmed.error).toBeNull();

      const rows = await revenueRows(db, companyId, contractId);
      expect(rows).toHaveLength(12);
      expect(rows.every((row) => row.amount === 100)).toBe(true);
      expect(rows.slice(0, 3).map((row) => row.status)).toEqual([
        "Recognized Externally",
        "Recognized Externally",
        "Planned"
      ]);

      const entries = await db
        .selectFrom("customerContractLedgerEntry")
        .select([
          "customerContractLineId",
          "entryType",
          sql<string>`"postingDate"::text`.as("postingDate"),
          "journalId",
          "deferredAmount",
          "deferredBase",
          "assetAmount",
          "assetBase"
        ])
        .where("customerContractId", "=", contractId)
        .where("companyId", "=", companyId)
        .execute();
      // 300 billed − 200 recognized = 100 deferred, at 0.8 per base unit.
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        customerContractLineId: lineId,
        entryType: "Opening",
        postingDate: "2026-01-01",
        journalId: null
      });
      expect(Number(entries[0]!.deferredAmount)).toBe(100);
      expect(Number(entries[0]!.deferredBase)).toBe(125);
      expect(Number(entries[0]!.assetAmount)).toBe(0);
      expect(Number(entries[0]!.assetBase)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a cancellation reconciles revenue: later months go, the end month is re-cut, a recognized month is caught up",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "cancel-revenue",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });
      await setEvenPeriodRevenue(db, companyId, lineId);
      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(confirmed.error).toBeNull();
      expect(await revenueRows(db, companyId, contractId)).toHaveLength(12);

      // March was already recognized (a run posted it early).
      await db
        .updateTable("customerContractRevenue")
        .set({ status: "Recognized" })
        .where("customerContractId", "=", contractId)
        .where("companyId", "=", companyId)
        .where("periodStart", "=", "2026-03-01")
        .execute();

      // A preview changes nothing.
      const preview = await postCustomerContract(ctx, {
        type: "cancel",
        customerContractId: contractId,
        asOf: "2026-02-01",
        endDate: "2026-02-14",
        reason: "Preview",
        creditUnusedTime: false,
        preview: true
      });
      expect(preview.error).toBeNull();
      expect(await revenueRows(db, companyId, contractId)).toHaveLength(12);

      const cancelled = await postCustomerContract(ctx, {
        type: "cancel",
        customerContractId: contractId,
        asOf: "2026-02-01",
        endDate: "2026-02-14",
        reason: "Closing the account",
        creditUnusedTime: false
      });
      expect(cancelled.error).toBeNull();

      // Billed: January 100 + 1–14 Feb (100 × 14/28 = 50) = 150. The new
      // plan is January 100 and February 50; March stays Recognized at 100,
      // so February carries the −100 catch-up.
      const rows = await revenueRows(db, companyId, contractId);
      expect(rows.map((row) => [row.periodStart, row.status])).toEqual([
        ["2026-01-01", "Planned"],
        ["2026-02-01", "Planned"],
        ["2026-03-01", "Recognized"]
      ]);
      expect(rows[0]!.amount).toBe(100);
      expect(rows[1]!.amount).toBeCloseTo(-50, 5);
      expect(rows[2]!.amount).toBe(100);
      const total = rows.reduce((sum, row) => sum + row.amount, 0);
      expect(total).toBeCloseTo(150, 5);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "rolling an open-ended schedule forward extends its revenue plan",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "roll-revenue",
        startDate: "2026-01-01",
        endDate: null
      });
      await setEvenPeriodRevenue(db, companyId, lineId);
      const confirmed = await postCustomerContract(ctx, {
        type: "confirm",
        customerContractId: contractId,
        asOf: "2026-01-01"
      });
      expect(confirmed.error).toBeNull();
      expect(
        (await revenueRows(db, companyId, contractId)).map((r) => [
          r.periodStart,
          r.amount
        ])
      ).toEqual([
        ["2026-01-01", 100],
        ["2026-02-01", 100]
      ]);

      const run = await createContractInvoices(ctx, {
        asOf: "2026-03-01",
        customerContractId: contractId
      });
      expect(run.error).toBeNull();
      expect(run.data!.failures).toEqual([]);
      expect(
        (await revenueRows(db, companyId, contractId)).map((r) => [
          r.periodStart,
          r.amount
        ])
      ).toEqual([
        ["2026-01-01", 100],
        ["2026-02-01", 100],
        ["2026-03-01", 100],
        ["2026-04-01", 100]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a line copy does not inherit its line's go-live or revenue dates, and an end clamps the revenue end",
  async () => {
    const f = await contractFixture();
    const { db, ctx, companyId } = f;
    const revenueDates = async (contractId: string) =>
      db
        .selectFrom("customerContractLine")
        .select([
          "id",
          sql<string>`"startDate"::text`.as("startDate"),
          sql<string | null>`"endDate"::text`.as("endDate"),
          sql<string | null>`"goLiveDate"::text`.as("goLiveDate"),
          sql<string | null>`"revenueStartDate"::text`.as("revenueStartDate"),
          sql<string | null>`"revenueEndDate"::text`.as("revenueEndDate")
        ])
        .where("customerContractId", "=", contractId)
        .where("companyId", "=", companyId)
        .orderBy("startDate")
        .execute();
    try {
      const { contractId, lineId } = await f.addRecurringContract({
        key: "revenue-dates",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      });
      await db
        .updateTable("customerContractLine")
        .set({ goLiveDate: "2026-01-15", revenueEndDate: "2026-11-30" })
        .where("id", "=", lineId)
        .where("companyId", "=", companyId)
        .execute();
      expect(
        (
          await postCustomerContract(ctx, {
            type: "confirm",
            customerContractId: contractId,
            asOf: "2026-01-01"
          })
        ).error
      ).toBeNull();

      const amended = await postCustomerContract(ctx, {
        type: "amend",
        customerContractId: contractId,
        asOf: "2026-03-15",
        amendmentDate: "2026-04-01",
        effect: "Change Date",
        contractType: "Expansion",
        reason: "One more seat",
        changes: [{ op: "change", lineId, quantity: 2 }]
      });
      expect(amended.error).toBeNull();
      expect(await revenueDates(contractId)).toMatchObject([
        {
          id: lineId,
          endDate: "2026-03-31",
          goLiveDate: "2026-01-15",
          revenueEndDate: "2026-03-31"
        },
        {
          startDate: "2026-04-01",
          endDate: null,
          goLiveDate: null,
          revenueStartDate: null,
          revenueEndDate: "2026-11-30"
        }
      ]);

      // A cancellation clamps the copy's revenue end; reverting restores it.
      expect(
        (
          await postCustomerContract(ctx, {
            type: "cancel",
            customerContractId: contractId,
            asOf: "2026-05-01",
            endDate: "2026-06-30",
            reason: "Closing the account",
            creditUnusedTime: false
          })
        ).error
      ).toBeNull();
      expect((await revenueDates(contractId))[1]).toMatchObject({
        endDate: "2026-06-30",
        revenueEndDate: "2026-06-30"
      });
      expect(
        (
          await postCustomerContract(ctx, {
            type: "revert-cancellation",
            customerContractId: contractId,
            asOf: "2026-05-01"
          })
        ).error
      ).toBeNull();
      expect((await revenueDates(contractId))[1]).toMatchObject({
        endDate: null,
        revenueEndDate: "2026-11-30"
      });
    } finally {
      await f.cleanup();
    }
  }
);
