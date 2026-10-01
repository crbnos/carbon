// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { ReimbursementSource } from "../../../../core/reimbursement-source";
import type { Qbo } from "../../models";
import {
  mapReimbursementToQboBill,
  QboReimbursementSyncer
} from "../reimbursement";

// QBO has no native reimbursement object, so the document is a Bill against
// an employee Vendor. What the mapper must get right is the pair the spec
// cares about: account-based expense lines for the coding, and APAccountRef
// carrying Carbon's SEGREGATED employee-payable control account rather than
// letting QBO imply the trade-AP account.

/**
 * The JIT vendor's mapping row is written inside `withTriggersDisabled`, a real
 * Kysely transaction that opens with a `SET LOCAL` statement. Stub it so the row
 * lands in `mappingRows` — the store the re-read under test then reads back.
 */
const { mappingRows } = vi.hoisted(() => ({
  mappingRows: new Map<string, string>()
}));
vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    cb: (tx: unknown) => Promise<unknown>
  ) => {
    const builder: Record<string, any> = {};
    builder.values = (value: any) => {
      for (const row of Array.isArray(value) ? value : [value]) {
        mappingRows.set(`${row.entityType}::${row.entityId}`, row.externalId);
      }
      return builder;
    };
    builder.onConflict = () => builder;
    builder.execute = async () => [];
    return cb({ insertInto: () => builder });
  }
}));

const reimbursement = (
  overrides: Partial<ReimbursementSource> = {}
): ReimbursementSource => ({
  id: "reimb_1",
  companyId: "company-1",
  reimbursementId: "REIMB-2026-09-000001",
  employeeId: "emp_1",
  status: "Posted",
  integration: "ramp",
  reimbursementDate: "2026-09-18",
  postingDate: "2026-09-20",
  currencyCode: "USD",
  exchangeRate: 1,
  amount: 620,
  payableAccountId: "acct_employee_payable",
  reference: "Trip to Austin",
  notes: null,
  updatedAt: "2026-09-20T10:00:00.000Z",
  employee: {
    id: "emp_1",
    firstName: "Dana",
    lastName: "Okafor",
    email: "dana@example.com"
  },
  employeeVendorExternalId: "qbo-vendor-77",
  baseCurrencyCode: "USD",
  decimalPlaces: 2,
  lines: [
    {
      id: "reimbl_1",
      accountId: "acct_travel",
      description: "Flights",
      amount: 500,
      sequence: 0,
      dimensions: [{ dimensionId: "dim_cc", valueId: "cc_eng" }]
    },
    {
      id: "reimbl_2",
      accountId: "acct_meals",
      description: "Meals",
      amount: 120,
      sequence: 1,
      dimensions: []
    }
  ],
  ...overrides
});

const accountRefs = new Map<string, Qbo.Ref>([
  ["acct_travel", { value: "61" }],
  ["acct_meals", { value: "62" }],
  ["acct_employee_payable", { value: "21" }]
]);

describe("mapReimbursementToQboBill", () => {
  it("builds a Bill against the employee vendor with one account-based line per coding line", () => {
    const payload = mapReimbursementToQboBill({
      reimbursement: reimbursement(),
      vendorRemoteId: "qbo-vendor-77",
      accountRefsById: accountRefs
    });

    expect(payload).toMatchObject({
      VendorRef: { value: "qbo-vendor-77" },
      // The whole point: the employee payable stays segregated in QBO too,
      // instead of QBO implying the trade-AP account.
      APAccountRef: { value: "21" },
      DocNumber: "REIMB-2026-09-000001",
      // The GL date Carbon booked, not the expense date.
      TxnDate: "2026-09-20",
      Line: [
        {
          Amount: 500,
          Description: "Flights",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "61" } }
        },
        {
          Amount: 120,
          Description: "Meals",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "62" } }
        }
      ]
    });
    // Base currency: no CurrencyRef / ExchangeRate noise.
    expect(payload).not.toHaveProperty("CurrencyRef");
    expect(payload).not.toHaveProperty("ExchangeRate");
  });

  it("puts a class slot on the line and a department slot on the transaction", () => {
    const payload = mapReimbursementToQboBill({
      reimbursement: reimbursement({
        lines: [
          {
            id: "reimbl_1",
            accountId: "acct_travel",
            description: "Flights",
            amount: 500,
            sequence: 0,
            dimensions: [
              { dimensionId: "dim_cc", valueId: "cc_eng" },
              { dimensionId: "dim_loc", valueId: "loc_hq" }
            ]
          }
        ]
      }),
      vendorRemoteId: "qbo-vendor-77",
      accountRefsById: accountRefs,
      dimensions: {
        slots: [
          { dimensionId: "dim_cc", target: "class" },
          { dimensionId: "dim_loc", target: "department" }
        ],
        refsByValue: new Map([
          ["dim_cc:cc_eng", { value: "class-1" }],
          ["dim_loc:loc_hq", { value: "dept-1" }]
        ])
      }
    });

    // DepartmentRef is transaction-level on a Bill; only ClassRef is per line.
    expect(payload.DepartmentRef).toEqual({ value: "dept-1" });
    expect(payload.Line[0]?.AccountBasedExpenseLineDetail?.ClassRef).toEqual({
      value: "class-1"
    });
  });

  it("inverts the rate for a foreign-currency reimbursement (QBO quotes home per foreign)", () => {
    const payload = mapReimbursementToQboBill({
      reimbursement: reimbursement({
        currencyCode: "EUR",
        baseCurrencyCode: "USD",
        // Carbon stores foreign-per-base: 0.8 EUR per 1 USD.
        exchangeRate: 0.8
      }),
      vendorRemoteId: "qbo-vendor-77",
      accountRefsById: accountRefs
    });

    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBeCloseTo(1.25, 10);
  });

  it("warns UNMAPPED_ACCOUNTS when a coding account has no QBO ref", () => {
    try {
      mapReimbursementToQboBill({
        reimbursement: reimbursement(),
        vendorRemoteId: "qbo-vendor-77",
        accountRefsById: new Map([
          ["acct_travel", { value: "61" }],
          ["acct_employee_payable", { value: "21" }]
        ])
      });
      throw new Error("expected a JournalEntrySyncError");
    } catch (err) {
      expect(err).toBeInstanceOf(JournalEntrySyncError);
      const failure = (err as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.warning).toBe(true);
      expect(failure.metadata?.unmappedAccountIds).toEqual(["acct_meals"]);
    }
  });
});

/**
 * The employee Vendor, resolved per record.
 *
 * `ChargeSyncerBase.pushBatchToAccounting` calls `fetchLocalBatch(ids)` exactly
 * ONCE, so every snapshot in a drain batch carries `employeeVendorExternalId` as
 * of that single read — `null` for all of them. Two Posted reimbursements for
 * one employee therefore both POSTed the same `DisplayName`, and the second
 * failed with Intuit fault 6240 and parked Failed. A Posted reimbursement's
 * `updatedAt` never changes, so nothing re-enqueued it without a human Retry.
 */
function makeEmployeeVendorSyncer() {
  let created = 0;
  const createVendor = vi.fn(async () => {
    created += 1;
    return { Id: `qbo-vendor-${created}` };
  });

  const syncer = new QboReimbursementSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: { id: "quickbooks", createVendor } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "reimbursement"
  });

  (syncer as any).mappingService = {
    getExternalId: async (entityType: string, entityId: string) =>
      mappingRows.get(`${entityType}::${entityId}`) ?? null
  };

  return {
    resolve: (local: ReimbursementSource) =>
      (syncer as any).resolveEmployeeVendor(local) as Promise<string>,
    createVendor,
    store: mappingRows
  };
}

describe("QboReimbursementSyncer.resolveEmployeeVendor", () => {
  beforeEach(() => {
    mappingRows.clear();
  });

  it("creates the employee Vendor ONCE for two reimbursements in one batch", async () => {
    const test = makeEmployeeVendorSyncer();
    // Both snapshots come from the SAME fetchLocalBatch, so both say null.
    const stale = reimbursement({ employeeVendorExternalId: null });

    const first = await test.resolve(stale);
    const second = await test.resolve(stale);

    expect(test.createVendor).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(test.store.get("employeeVendor::emp_1")).toBe(first);
  });

  it("reuses an already-mapped Vendor without creating one", async () => {
    const test = makeEmployeeVendorSyncer();
    test.store.set("employeeVendor::emp_1", "qbo-vendor-77");

    expect(
      await test.resolve(reimbursement({ employeeVendorExternalId: null }))
    ).toBe("qbo-vendor-77");
    expect(test.createVendor).not.toHaveBeenCalled();
  });
});
