// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A Draft lease's terms and assets are saved together with the payment rows
// cut from them, in one transaction. Live database: the writes are Kysely
// transactions, so they cannot be faked.

import { readFileSync } from "node:fs";
import { sql } from "kysely";
import { expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import { leaseFixture } from "../../../../../packages/server-functions/src/post-lease/lease-test-fixture";
import {
  leaseOpeningAsOf,
  regenerateLeasePayments,
  saveDraftLeaseLine,
  updateDraftLease
} from "./purchasing.server";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// vitest.config.ts stubs SUPABASE_DB_URL for every ERP test, so the local
// database is read from the repository's .env.local. Without one, or with
// the stack down, the tests skip.
const localDatabaseUrl = (() => {
  try {
    const env = readFileSync(
      new URL("../../../../../.env.local", import.meta.url),
      "utf8"
    );
    const url = env.match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
    return url && LOCAL_HOSTS.includes(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
})();

type Fixture = Awaited<ReturnType<typeof leaseFixture>>;

function leaseTest(name: string, fn: (f: Fixture) => Promise<void>) {
  it.skipIf(!localDatabaseUrl)(
    name,
    async (context) => {
      process.env.SUPABASE_DB_URL = localDatabaseUrl!;
      let f: Fixture;
      try {
        f = await leaseFixture();
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ECONNREFUSED"
        ) {
          context.skip();
        }
        throw error;
      }
      try {
        await fn(f);
      } finally {
        await f.cleanup();
      }
    },
    60_000
  );
}

/** The terms the fixture's lease was created with, as the validator gives
 *  them. */
const TERMS = {
  supplierId: "",
  commencementDate: "2027-01-01",
  endDate: "2029-12-31",
  invoiceFromDate: "2027-01-01",
  paymentFrequency: "Monthly" as const,
  paymentTiming: "Arrears" as const,
  annualEscalationPercent: 0,
  discountRate: 6,
  currencyCode: "USD"
};

async function rows(f: Fixture, leaseLineId?: string) {
  let query = f.db
    .selectFrom("leasePayment")
    .select([
      "id",
      "leaseLineId",
      "amount",
      "status",
      sql<string>`"dueDate"::text`.as("dueDate")
    ])
    .where("leaseId", "=", f.leaseId);
  if (leaseLineId) query = query.where("leaseLineId", "=", leaseLineId);
  return query.orderBy("dueDate").execute();
}

leaseTest(
  "moving the commencement saves it and cuts the rows again, invoicing with it",
  async (f) => {
    const { paymentsCut } = await updateDraftLease(f.db, {
      leaseId: f.leaseId,
      companyId: f.companyId,
      userId: "system",
      terms: {
        ...TERMS,
        supplierId: f.supplierId,
        commencementDate: "2027-03-01",
        endDate: "2030-02-28"
      }
    });
    expect(paymentsCut).toBe(true);

    const lease = await f.db
      .selectFrom("lease")
      .select([
        sql<string>`"commencementDate"::text`.as("commencementDate"),
        sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate")
      ])
      .where("id", "=", f.leaseId)
      .executeTakeFirstOrThrow();
    expect(lease).toEqual({
      commencementDate: "2027-03-01",
      invoiceFromDate: "2027-03-01"
    });
    const cut = await rows(f);
    expect(cut).toHaveLength(36);
    expect(cut[0]!.dueDate).toBe("2027-03-31");
    expect(cut.every((row) => row.status === "Pending")).toBe(true);
  }
);

leaseTest(
  "a change to a term the rows are not cut from keeps the edited rows",
  async (f) => {
    const [first] = await rows(f);
    await f.db
      .updateTable("leasePayment")
      .set({ amount: 0.01 })
      .where("id", "=", first!.id)
      .execute();

    const { paymentsCut } = await updateDraftLease(f.db, {
      leaseId: f.leaseId,
      companyId: f.companyId,
      userId: "system",
      terms: { ...TERMS, supplierId: f.supplierId, name: "Renamed" }
    });
    expect(paymentsCut).toBe(false);
    expect((await rows(f))[0]!.amount).toBe(0.01);
  }
);

leaseTest(
  "a lease that is no longer a Draft is refused, and nothing is written",
  async (f) => {
    await f.db
      .updateTable("lease")
      .set({ status: "Active" })
      .where("id", "=", f.leaseId)
      .execute();
    await expect(
      updateDraftLease(f.db, {
        leaseId: f.leaseId,
        companyId: f.companyId,
        userId: "system",
        terms: {
          ...TERMS,
          supplierId: f.supplierId,
          commencementDate: "2027-03-01"
        }
      })
    ).rejects.toThrow(/only while the lease is Draft/);
    await expect(
      saveDraftLeaseLine(f.db, {
        leaseId: f.leaseId,
        companyId: f.companyId,
        userId: "system",
        line: {
          description: "Forklift FL-99",
          paymentAmount: 500,
          ownershipTransfers: false,
          specializedAsset: false,
          purchaseOptionReasonablyCertain: false
        }
      })
    ).rejects.toThrow(/only while the lease is Draft/);
    expect(
      (
        await f.db
          .selectFrom("lease")
          .select(sql<string>`"commencementDate"::text`.as("commencementDate"))
          .where("id", "=", f.leaseId)
          .executeTakeFirstOrThrow()
      ).commencementDate
    ).toBe("2027-01-01");
  }
);

leaseTest(
  "an asset is added with its rows; when they cannot be cut, the asset is not added",
  async (f) => {
    const added = await saveDraftLeaseLine(f.db, {
      leaseId: f.leaseId,
      companyId: f.companyId,
      userId: "system",
      line: {
        description: "Forklift FL-13",
        paymentAmount: 500,
        ownershipTransfers: false,
        specializedAsset: false,
        purchaseOptionReasonablyCertain: false
      }
    });
    expect(added.paymentsCut).toBe(true);
    const cut = await rows(f, added.id);
    expect(cut).toHaveLength(36);
    expect(cut.every((row) => row.amount === 500)).toBe(true);

    // A currency the company has not set up: the rows cannot be cut.
    await f.db
      .updateTable("lease")
      .set({ currencyCode: "XTS" })
      .where("id", "=", f.leaseId)
      .execute();
    await expect(
      saveDraftLeaseLine(f.db, {
        leaseId: f.leaseId,
        companyId: f.companyId,
        userId: "system",
        line: {
          description: "Forklift FL-14",
          paymentAmount: 500,
          ownershipTransfers: false,
          specializedAsset: false,
          purchaseOptionReasonablyCertain: false
        }
      })
    ).rejects.toThrow(/XTS/);
    const descriptions = await f.db
      .selectFrom("leaseLine")
      .select("description")
      .where("leaseId", "=", f.leaseId)
      .execute();
    expect(descriptions.map((line) => line.description)).not.toContain(
      "Forklift FL-14"
    );
  }
);

leaseTest(
  "an asset's payment cuts its rows again; its description does not",
  async (f) => {
    const leaseLineId = f.lineIds[0]!;
    const asset = {
      description: "Forklift FL-12",
      paymentAmount: 10000,
      ownershipTransfers: false,
      specializedAsset: false,
      purchaseOptionReasonablyCertain: false
    };
    const renamed = await saveDraftLeaseLine(f.db, {
      leaseId: f.leaseId,
      leaseLineId,
      companyId: f.companyId,
      userId: "system",
      line: { ...asset, description: "Forklift FL-12B" }
    });
    expect(renamed.paymentsCut).toBe(false);

    const repriced = await saveDraftLeaseLine(f.db, {
      leaseId: f.leaseId,
      leaseLineId,
      companyId: f.companyId,
      userId: "system",
      line: { ...asset, paymentAmount: 12000 }
    });
    expect(repriced.paymentsCut).toBe(true);
    const cut = await rows(f, leaseLineId);
    expect(cut).toHaveLength(36);
    expect(cut.every((row) => row.amount === 12000)).toBe(true);
  }
);

leaseTest("a lease with no asset has no rows to cut", async (f) => {
  await f.db.deleteFrom("leaseLine").where("leaseId", "=", f.leaseId).execute();
  expect(
    await regenerateLeasePayments(f.db, {
      leaseId: f.leaseId,
      companyId: f.companyId,
      userId: "system"
    })
  ).toEqual({ count: 0 });
});

leaseTest(
  "an opening balance opens on the cutover, or the first open period after a locked one",
  async (f) => {
    const asOf = () =>
      leaseOpeningAsOf(f.db, {
        companyId: f.companyId,
        cutoverDate: "2026-01-01"
      });
    expect(await asOf()).toBe("2026-01-01");

    await f.db
      .insertInto("accountingPeriod")
      .values([
        {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          fiscalYear: 2026,
          periodNumber: 1,
          status: "Inactive",
          closeStatus: "Locked",
          companyId: f.companyId,
          createdBy: "system"
        },
        {
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          fiscalYear: 2026,
          periodNumber: 2,
          status: "Inactive",
          closeStatus: "Open",
          companyId: f.companyId,
          createdBy: "system"
        }
      ])
      .execute();
    expect(await asOf()).toBe("2026-02-01");
  }
);
