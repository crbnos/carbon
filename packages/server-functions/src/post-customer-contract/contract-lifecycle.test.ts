// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A contract's life against the live database: confirm → draft the first
// invoice → amend mid-period → draft the next → cancel with a credit → end.
// Runs both server functions (`post-customer-contract`,
// `create-contract-invoices`) through their real entry points on a scratch
// company that is deleted afterwards.

import type { KyselyDatabase } from "@carbon/database/client";
import { CONTRACT_HOLD_ADJUSTMENT } from "@carbon/utils";
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
          kind: "One-time",
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
          kind: "Recurring",
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
            kind: "Recurring",
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
      "kind",
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
      kind: "One-time",
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
              kind: "Recurring",
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
            kind: "Recurring",
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
