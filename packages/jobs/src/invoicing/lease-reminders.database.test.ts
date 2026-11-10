// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The daily job's lease writes against a live local database: stamping the
// reminded dates, and expiring the leases that have run their course.
// Skipped without a local SUPABASE_DB_URL.

import {
  getPostgresClient,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dueLeaseReminders,
  expireLeases,
  stampLeaseReminders
} from "./lease-reminders";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const hasLocalDatabase = (() => {
  try {
    return LOCAL_HOSTS.includes(
      new URL(process.env.SUPABASE_DB_URL ?? "").hostname
    );
  } catch {
    return false;
  }
})();

const USER = "system";

describe.skipIf(!hasLocalDatabase)("lease writes of the daily job", () => {
  let db: Kysely<KyselyDatabase>;
  const prefix = `leasejob-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const supplierId = `${prefix}-supplier`;

  beforeAll(async () => {
    db = getPostgresClient<KyselyDatabase>(
      new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 }),
      PostgresDriver
    );
    await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
      db
    );
    await db
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await db
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD"
      })
      .execute();
    await db
      .insertInto("supplier")
      .values({ id: supplierId, name: prefix, companyId })
      .execute();
  });

  afterAll(async () => {
    if (!db) return;
    await db.deleteFrom("company").where("id", "=", companyId).execute();
    await db.deleteFrom("companyGroup").where("id", "=", groupId).execute();
    for (const table of [`searchIndex_${companyId}`, `auditLog_${companyId}`]) {
      await sql`DROP TABLE IF EXISTS ${sql.id(table)}`.execute(db);
    }
    await db.destroy();
  });

  /** An Active lease with one Active asset; `rouLeft` is the asset's last
   *  schedule line's closing right-of-use asset. */
  async function insertLease(args: {
    key: string;
    endDate: string;
    noticeDate?: string;
    pendingPayment?: boolean;
    rouLeft?: number;
  }): Promise<string> {
    const id = `${prefix}-${args.key}`;
    const lineId = `${id}-line`;
    await db
      .insertInto("lease")
      .values({
        id,
        leaseId: args.key.toUpperCase(),
        name: args.key,
        supplierId,
        status: "Active",
        commencementDate: "2027-01-01",
        endDate: args.endDate,
        noticeDate: args.noticeDate ?? null,
        invoiceFromDate: "2027-01-01",
        discountRate: 6,
        currencyCode: "USD",
        companyId,
        createdBy: USER
      })
      .execute();
    await db
      .insertInto("leaseLine")
      .values({
        id: lineId,
        leaseId: id,
        description: args.key,
        paymentAmount: 1000,
        status: "Active",
        lesseeClassification: "Operating",
        companyId,
        createdBy: USER
      })
      .execute();
    await db
      .insertInto("leaseScheduleLine")
      .values({
        leaseId: id,
        leaseLineId: lineId,
        periodDate: args.endDate,
        openingLiability: 1000,
        paymentAmount: 1000,
        interestAmount: 0,
        principalAmount: 1000,
        closingLiability: 0,
        leaseCost: 1000,
        rouAmortization: 1000,
        closingRouAsset: args.rouLeft ?? 0,
        companyId,
        createdBy: USER
      })
      .execute();
    await db
      .insertInto("leasePayment")
      .values({
        leaseId: id,
        leaseLineId: lineId,
        periodStart: "2027-01-01",
        periodEnd: args.endDate,
        dueDate: "2027-01-01",
        amount: 1000,
        status: args.pendingPayment ? "Pending" : "Skipped",
        companyId,
        createdBy: USER
      })
      .execute();
    return id;
  }

  async function statusOf(id: string) {
    const lease = await db
      .selectFrom("lease")
      .select("status")
      .where("companyId", "=", companyId)
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const line = await db
      .selectFrom("leaseLine")
      .select("status")
      .where("companyId", "=", companyId)
      .where("leaseId", "=", id)
      .executeTakeFirstOrThrow();
    return [lease.status, line.status];
  }

  it("stamps the reminded dates, but not a date moved since it was read", async () => {
    // Still owed a payment, so the expiry test below leaves it alone.
    const id = await insertLease({
      key: "remind",
      noticeDate: "2027-02-01",
      endDate: "2027-03-31",
      pendingPayment: true
    });
    const reminders = dueLeaseReminders(
      [
        {
          id,
          noticeDate: "2027-02-01",
          endDate: "2027-03-31",
          noticeRemindedFor: null,
          endRemindedFor: null
        }
      ],
      "2027-01-15",
      90
    );
    expect(reminders.map((r) => r.kind)).toEqual(["notice", "end"]);

    // The notice date moves after the job read it: the new date is still
    // to be reminded.
    await db
      .updateTable("lease")
      .set({ noticeDate: "2027-02-15" })
      .where("companyId", "=", companyId)
      .where("id", "=", id)
      .execute();
    await stampLeaseReminders(db, companyId, reminders);

    const lease = await db
      .selectFrom("lease")
      .select(["noticeRemindedFor", "endRemindedFor"])
      .where("companyId", "=", companyId)
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(lease).toEqual({
      noticeRemindedFor: null,
      endRemindedFor: "2027-03-31"
    });
  }, 60_000);

  it("expires a lease past its end only when nothing is left to bill or amortize", async () => {
    const done = await insertLease({ key: "done", endDate: "2027-06-30" });
    // A residue under half a cent is fully amortized.
    const residue = await insertLease({
      key: "residue",
      endDate: "2027-06-30",
      rouLeft: 0.001
    });
    const unbilled = await insertLease({
      key: "unbilled",
      endDate: "2027-06-30",
      pendingPayment: true
    });
    const owned = await insertLease({
      key: "owned",
      endDate: "2027-06-30",
      rouLeft: 4000
    });
    const running = await insertLease({
      key: "running",
      endDate: "2027-07-01"
    });

    expect(await expireLeases(db, companyId, "2027-07-01")).toBe(2);

    expect(await statusOf(done)).toEqual(["Expired", "Expired"]);
    expect(await statusOf(residue)).toEqual(["Expired", "Expired"]);
    expect(await statusOf(unbilled)).toEqual(["Active", "Active"]);
    expect(await statusOf(owned)).toEqual(["Active", "Active"]);
    expect(await statusOf(running)).toEqual(["Active", "Active"]);
  }, 60_000);
});
