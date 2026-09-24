import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { ReimbursementSource } from "../../../../core/reimbursement-source";
import { mapReimbursementToXeroInvoice } from "../reimbursement";

// Xero has no reimbursement object: the document is an ACCPAY invoice against
// an employee Contact. The two things the mapper must not get wrong are the
// ACCPAY field set (Reference is ACCREC-ONLY — the Carbon readable id has to
// ride InvoiceNumber) and the two-decimal monetary boundary.

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
