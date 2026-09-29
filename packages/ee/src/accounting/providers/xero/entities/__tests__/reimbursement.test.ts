import { beforeEach, describe, expect, it, vi } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { ReimbursementSource } from "../../../../core/reimbursement-source";
import {
  mapReimbursementToXeroInvoice,
  XeroReimbursementSyncer
} from "../reimbursement";

// Xero has no reimbursement object: the document is an ACCPAY invoice against
// an employee Contact. The two things the mapper must not get wrong are the
// ACCPAY field set (Reference is ACCREC-ONLY — the Carbon readable id has to
// ride InvoiceNumber) and the two-decimal monetary boundary.

/**
 * The JIT contact's mapping row is written inside `withTriggersDisabled`, a real
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
  employeeVendorExternalId: "xero-contact-uuid",
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

const accountCodes = new Map([
  ["acct_travel", "420"],
  ["acct_meals", "430"]
]);

describe("mapReimbursementToXeroInvoice", () => {
  it("builds an AUTHORISED ACCPAY invoice with one NoTax line per coding line", () => {
    const payload = mapReimbursementToXeroInvoice({
      reimbursement: reimbursement(),
      contactId: "xero-contact-uuid",
      accountCodesById: accountCodes
    });

    expect(payload).toMatchObject({
      Type: "ACCPAY",
      // ACCPAY has NO Reference field — the Carbon readable id rides
      // InvoiceNumber, which is also what Xero's UI shows as "Reference".
      InvoiceNumber: "REIMB-2026-09-000001",
      Contact: { ContactID: "xero-contact-uuid" },
      // The GL date Carbon booked, not the expense date.
      Date: "2026-09-20",
      Status: "AUTHORISED",
      LineAmountTypes: "NoTax",
      CurrencyCode: "USD",
      LineItems: [
        {
          Description: "Flights",
          Quantity: 1,
          UnitAmount: 500,
          AccountCode: "420",
          TaxType: "NONE"
        },
        {
          Description: "Meals",
          Quantity: 1,
          UnitAmount: 120,
          AccountCode: "430",
          TaxType: "NONE"
        }
      ]
    });
    // Sending Reference on an ACCPAY is silently dropped by Xero, so keying
    // anything on it (recovery, provenance) would recover nothing.
    expect(payload).not.toHaveProperty("Reference");
    // Contact carries ContactID ONLY — other fields mutate the contact record.
    expect(Object.keys(payload.Contact)).toEqual(["ContactID"]);
    // Base currency: no rate pinned.
    expect(payload.CurrencyRate).toBeUndefined();
  });

  it("pins CurrencyRate on a foreign-currency reimbursement", () => {
    const payload = mapReimbursementToXeroInvoice({
      reimbursement: reimbursement({
        currencyCode: "EUR",
        baseCurrencyCode: "USD",
        exchangeRate: 0.8
      }),
      contactId: "xero-contact-uuid",
      accountCodesById: accountCodes
    });

    expect(payload.CurrencyCode).toBe("EUR");
    expect(payload.CurrencyRate).toBe(0.8);
  });

  it("attaches per-line Tracking for a slotted dimension", () => {
    const payload = mapReimbursementToXeroInvoice({
      reimbursement: reimbursement(),
      contactId: "xero-contact-uuid",
      accountCodesById: accountCodes,
      dimensions: {
        slots: [{ dimensionId: "dim_cc", target: "tracking:cat-1" }],
        optionIdsByValue: new Map([["dim_cc:cc_eng", "opt-1"]])
      }
    });

    expect(payload.LineItems[0]?.Tracking).toEqual([
      { TrackingCategoryID: "cat-1", TrackingOptionID: "opt-1" }
    ]);
    // A line with no slotted dimension sends no Tracking key at all.
    expect(payload.LineItems[1]).not.toHaveProperty("Tracking");
  });

  it("does NOT require the payable control account to be mapped — Xero cannot name it", () => {
    // The employee-payable account is absent from accountCodes and the
    // reimbursement still maps: Xero's AP control account is an
    // organisation-level system account, so demanding a mapping Xero cannot
    // use would park a document Xero would have accepted.
    expect(() =>
      mapReimbursementToXeroInvoice({
        reimbursement: reimbursement(),
        contactId: "xero-contact-uuid",
        accountCodesById: accountCodes
      })
    ).not.toThrow();
  });

  it("warns UNMAPPED_ACCOUNTS when a coding account has no Xero code", () => {
    try {
      mapReimbursementToXeroInvoice({
        reimbursement: reimbursement(),
        contactId: "xero-contact-uuid",
        accountCodesById: new Map([["acct_travel", "420"]])
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

  it("refuses principal Xero's two decimals cannot represent", () => {
    expect(() =>
      mapReimbursementToXeroInvoice({
        reimbursement: reimbursement({
          lines: [
            {
              id: "reimbl_1",
              accountId: "acct_travel",
              description: "Flights",
              amount: 500.005,
              sequence: 0,
              dimensions: []
            }
          ]
        }),
        contactId: "xero-contact-uuid",
        accountCodesById: accountCodes
      })
    ).toThrow(/two decimal places/);
  });
});

/**
 * The employee Contact, resolved per record.
 *
 * `ChargeSyncerBase.pushBatchToAccounting` calls `fetchLocalBatch(ids)` exactly
 * ONCE, so every snapshot in a drain batch carries `employeeVendorExternalId` as
 * of that single read — `null` for all of them. Two Posted reimbursements for
 * one employee therefore both POSTed the same contact `Name`, and the second
 * failed Xero's unique-name validation and parked Failed. A Posted
 * reimbursement's `updatedAt` never changes, so nothing re-enqueued it.
 */
function makeEmployeeContactSyncer() {
  let created = 0;
  // Resolving now makes TWO kinds of request: a name lookup that recovers a
  // Contact a crashed run left behind, then a create when it finds none. The
  // mock has to tell them apart, or "created once" cannot be asserted at all.
  const request = vi.fn(async (method: string, _url: string) => {
    if (method === "GET") {
      // No Contact of that name exists in this fixture, so the lookup finds
      // nothing and the create below runs. `Name` is absent on purpose: the
      // finder matches on it exactly, so a nameless row must NOT be adopted.
      return { error: false, data: { Contacts: [] } };
    }
    created += 1;
    return {
      error: false,
      data: { Contacts: [{ ContactID: `xero-contact-${created}` }] }
    };
  });
  const creates = () =>
    request.mock.calls.filter(([method]) => method === "POST");
  const lookups = () =>
    request.mock.calls.filter(([method]) => method === "GET");

  const syncer = new XeroReimbursementSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: { id: "xero", request } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "reimbursement"
  });

  (syncer as any).mappingService = {
    getExternalId: async (entityType: string, entityId: string) =>
      mappingRows.get(`${entityType}::${entityId}`) ?? null
  };

  return {
    resolve: (local: ReimbursementSource) =>
      (syncer as any).resolveEmployeeContact(local) as Promise<string>,
    request,
    creates,
    lookups,
    store: mappingRows
  };
}

describe("XeroReimbursementSyncer.resolveEmployeeContact", () => {
  beforeEach(() => {
    mappingRows.clear();
  });

  it("creates the employee Contact ONCE for two reimbursements in one batch", async () => {
    const test = makeEmployeeContactSyncer();
    // Both snapshots come from the SAME fetchLocalBatch, so both say null.
    const stale = reimbursement({ employeeVendorExternalId: null });

    const first = await test.resolve(stale);
    const second = await test.resolve(stale);

    // ONE create across both — the second resolve re-reads the mapping the
    // first one wrote, so it neither looks up nor creates.
    expect(test.creates()).toHaveLength(1);
    expect(test.lookups()).toHaveLength(1);
    expect(second).toBe(first);
    expect(test.store.get("employeeVendor::emp_1")).toBe(first);
  });

  it("reuses an already-mapped Contact without creating one", async () => {
    const test = makeEmployeeContactSyncer();
    test.store.set("employeeVendor::emp_1", "xero-contact-uuid");

    expect(
      await test.resolve(reimbursement({ employeeVendorExternalId: null }))
    ).toBe("xero-contact-uuid");
    expect(test.request).not.toHaveBeenCalled();
  });
});
