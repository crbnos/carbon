// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  allocatePaymentFunding,
  type FundingScope,
  type FundingSource,
  toBaseAmount
} from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  type ApplyRow,
  type ApplyTargets,
  aggregateApplications,
  autoApplyRows,
  buildApplications,
  buildCreditApplications,
  type ExistingApplication,
  fundingRequests,
  initialPaymentKind,
  type OpenInvoice,
  type PaymentApplication,
  paymentDocumentCurrency,
  paymentKindFields,
  seedApplyRows,
  seedCreditRows,
  toggleApplyRow,
  toggleCreditRow,
  unappliedPaymentCash,
  updateApplyAmount,
  updateCreditAmount
} from "./payment-logic";

describe("payment kind", () => {
  it.each([
    ["customer-payment", "Receipt", "customerId", ["supplierId", "employeeId"]],
    [
      "customer-refund",
      "Disbursement",
      "customerId",
      ["supplierId", "employeeId"]
    ],
    [
      "supplier-payment",
      "Disbursement",
      "supplierId",
      ["customerId", "employeeId"]
    ],
    ["supplier-refund", "Receipt", "supplierId", ["customerId", "employeeId"]],
    // An employee is always paid out, never a receipt.
    [
      "employee-payment",
      "Disbursement",
      "employeeId",
      ["customerId", "supplierId"]
    ]
  ])(
    "%s submits a %s to %s and blanks the other parties",
    (kind, paymentType, party, blank) => {
      expect(paymentKindFields(kind)).toEqual({ paymentType, party, blank });
    }
  );

  it.each([
    "customer-payment",
    "customer-refund",
    "supplier-payment",
    "supplier-refund",
    "employee-payment"
  ])("a saved %s reopens as the same kind", (kind) => {
    const { paymentType, party } = paymentKindFields(kind);
    expect(initialPaymentKind({ paymentType, [party]: "party-id" })).toBe(kind);
  });

  it.each([
    ["EUR", "USD", "EUR"],
    ["", "USD", "USD"],
    [undefined, undefined, "USD"]
  ])(
    "enters the total of a %s payment in a %s company as %s",
    (currency, base, expected) => {
      expect(paymentDocumentCurrency(currency, base)).toBe(expected);
    }
  );
});

describe("apply to invoices", () => {
  const TODAY = "2026-09-07";
  const receipt: ApplyTargets = {
    isReceipt: true,
    isRefund: false,
    isReimbursement: false
  };

  // A EUR payment in a USD company: each invoice carries its own rate snapshot.
  const invoice = (overrides: Partial<OpenInvoice> = {}): OpenInvoice => ({
    id: "one",
    invoiceId: "INV1",
    dateDue: null,
    currencyCode: "EUR",
    exchangeRate: 1.1,
    totalAmount: 100,
    balance: 100,
    remainingDocument: 110,
    status: "Submitted",
    ...overrides
  });
  const two = invoice({
    id: "two",
    invoiceId: "INV2",
    exchangeRate: 1.2,
    totalAmount: 50,
    balance: 50,
    remainingDocument: 60
  });

  type Setup = {
    targets: ApplyTargets;
    openInvoices: OpenInvoice[];
    existingApplications: ExistingApplication[];
    paymentTotal: number;
    paymentExchangeRate: number;
    priorSources: FundingSource[];
    paymentScope: FundingScope | null;
  };
  function base(overrides: Partial<Setup> = {}) {
    const setup: Setup = {
      targets: receipt,
      openInvoices: [invoice(), two],
      existingApplications: [],
      paymentTotal: 170,
      paymentExchangeRate: 1.2,
      priorSources: [],
      paymentScope: null,
      ...overrides
    };
    const funding = {
      currentPayment: {
        paymentId: "current",
        postingDate: TODAY,
        exchangeRate: setup.paymentExchangeRate,
        remainingDocument: setup.paymentTotal,
        remainingBase: toBaseAmount(
          setup.paymentTotal,
          setup.paymentExchangeRate
        ),
        scope: setup.paymentScope
      },
      priorSources: setup.priorSources,
      currencyDecimals: 2
    };
    const rows = seedApplyRows({
      openInvoices: setup.openInvoices,
      existingApplications: setup.existingApplications,
      targets: setup.targets,
      paymentCurrency: "EUR",
      paymentScope: setup.paymentScope,
      currencyDecimals: 2
    });
    return {
      rows,
      funding,
      autoApply: (from: ApplyRow[] = rows) =>
        autoApplyRows(from, {
          ...funding,
          isReceipt: setup.targets.isReceipt
        }),
      select: (id: string, from: ApplyRow[] = rows) =>
        toggleApplyRow(from, id, true, funding),
      save: (from: ApplyRow[]) =>
        buildApplications(from, {
          targets: setup.targets,
          paymentExchangeRate: setup.paymentExchangeRate,
          today: TODAY
        })
    };
  }

  // What a saved draft reads back: the database holds null, not a missing key.
  const reopen = (apps: ReturnType<ReturnType<typeof base>["save"]>) =>
    apps.map((app) => ({
      ...app,
      targetSalesInvoiceId: app.targetSalesInvoiceId ?? null,
      targetPurchaseInvoiceId: app.targetPurchaseInvoiceId ?? null
    }));

  it("auto applies 170 EUR to invoices of 110 and 60 EUR at their own rates", () => {
    const table = base();
    expect(table.save(table.autoApply())).toEqual([
      {
        targetSalesInvoiceId: "one",
        targetPurchaseInvoiceId: undefined,
        targetMemoId: undefined,
        targetReimbursementId: undefined,
        appliedAmount: 100,
        sourceAmount: 110,
        discountAmount: 0,
        writeOffAmount: 0,
        targetExchangeRate: 1.1,
        sourceExchangeRate: 1.2,
        appliedDate: TODAY
      },
      {
        targetSalesInvoiceId: "two",
        targetPurchaseInvoiceId: undefined,
        targetMemoId: undefined,
        targetReimbursementId: undefined,
        appliedAmount: 50,
        sourceAmount: 60,
        discountAmount: 0,
        writeOffAmount: 0,
        targetExchangeRate: 1.2,
        sourceExchangeRate: 1.2,
        appliedDate: TODAY
      }
    ]);
  });

  it.each([
    ["a receipt", receipt, "targetSalesInvoiceId"],
    [
      "a disbursement",
      { isReceipt: false, isRefund: false, isReimbursement: false },
      "targetPurchaseInvoiceId"
    ],
    [
      "a refund receipt",
      { isReceipt: true, isRefund: true, isReimbursement: false },
      "targetMemoId"
    ],
    [
      "a refund disbursement",
      { isReceipt: false, isRefund: true, isReimbursement: false },
      "targetMemoId"
    ],
    [
      "an employee payment",
      { isReceipt: false, isRefund: false, isReimbursement: true },
      "targetReimbursementId"
    ]
  ] as const)(
    "%s targets %s only, and resaves unchanged when reopened",
    (_kind, targets, column) => {
      const table = base({
        targets,
        paymentTotal: 110,
        openInvoices: [invoice()]
      });
      const saved = table.save(table.autoApply());
      expect(saved).toEqual([
        {
          targetSalesInvoiceId: undefined,
          targetPurchaseInvoiceId: undefined,
          targetMemoId: undefined,
          targetReimbursementId: undefined,
          [column]: "one",
          appliedAmount: 100,
          sourceAmount: 110,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1.1,
          sourceExchangeRate: 1.2,
          appliedDate: TODAY
        }
      ]);

      const reopened = base({
        targets,
        paymentTotal: 110,
        openInvoices: [invoice()],
        existingApplications: reopen(saved)
      });
      expect(reopened.save(reopened.rows)).toEqual(saved);
    }
  );

  it("sums a reopened draft's funding splits into one row per invoice", () => {
    const split = {
      targetSalesInvoiceId: "one",
      targetPurchaseInvoiceId: null,
      discountAmount: 0,
      writeOffAmount: 0,
      targetExchangeRate: 1.1,
      appliedDate: TODAY
    };
    const table = base({
      existingApplications: [
        {
          ...split,
          appliedAmount: 40,
          sourceAmount: 44,
          sourcePaymentId: null,
          sourceExchangeRate: 1.2
        },
        {
          ...split,
          appliedAmount: 60,
          sourceAmount: 66,
          sourcePaymentId: "prior",
          sourceExchangeRate: 1.1
        }
      ]
    });
    expect(table.save(table.rows)).toEqual([
      expect.objectContaining({
        targetSalesInvoiceId: "one",
        appliedAmount: 100,
        sourceAmount: 110,
        sourceExchangeRate: 1.2
      })
    ]);
  });

  it("moves cash out of a fully relieved row as discount and write-off are entered", () => {
    // 110 EUR at 1.1 relieves 100 USD. A 10 USD discount is 11 EUR and a 5 USD
    // write-off 5.50 EUR, so the cash left is 110 - 16.50 = 93.50 EUR.
    const table = base();
    const discounted = updateApplyAmount(
      table.select("one"),
      "one",
      "discountAmount",
      10,
      2
    );
    const writtenOff = updateApplyAmount(
      discounted,
      "one",
      "writeOffAmount",
      5,
      2
    );
    expect(table.save(writtenOff)).toEqual([
      expect.objectContaining({
        appliedAmount: 85,
        sourceAmount: 93.5,
        discountAmount: 10,
        writeOffAmount: 5
      })
    ]);
  });

  it("selecting an invoice in full relieves its whole carrying balance", () => {
    // 110 EUR at 1.1 converts to 100.00, but the invoice still carries 100.01.
    const table = base({ openInvoices: [invoice({ balance: 100.01 })] });
    expect(table.save(table.select("one"))).toEqual([
      expect.objectContaining({ appliedAmount: 100.01, sourceAmount: 110 })
    ]);
  });

  it("shows nothing for invoices in another currency or with nothing open", () => {
    expect(
      base({
        openInvoices: [
          invoice({ currencyCode: "USD" }),
          invoice({ id: "two", remainingDocument: 0 })
        ]
      }).rows
    ).toEqual([]);
  });

  describe("at a rate where one base cent is 160.01 document units", () => {
    // 0.01 USD carried, 160.01 EUR open, funded by a prior 160.01 EUR receipt.
    const highRate = (overrides: Partial<Setup> = {}) =>
      base({
        paymentTotal: 0,
        paymentExchangeRate: 16000,
        priorSources: [
          {
            paymentId: "prior",
            postingDate: "2026-09-01",
            exchangeRate: 16000,
            remainingDocument: 160.01,
            remainingBase: 0.01
          }
        ],
        openInvoices: [
          invoice({
            exchangeRate: 16000,
            totalAmount: 0.01,
            balance: 0.01,
            remainingDocument: 160.01
          })
        ],
        ...overrides
      });
    const saved = (sourceAmount: number): ExistingApplication => ({
      targetSalesInvoiceId: "one",
      targetPurchaseInvoiceId: null,
      appliedAmount: 0.01,
      sourceAmount,
      discountAmount: 0,
      writeOffAmount: 0,
      targetExchangeRate: 16000,
      sourceExchangeRate: 16000,
      appliedDate: TODAY
    });

    it.each([
      ["a new draft", []],
      ["a reopened full application", [saved(160.01)]]
    ])(
      "converts a typed 0.01 base to 160.00 document units on %s",
      (_draft, existingApplications) => {
        const table = highRate({ existingApplications });
        expect(
          table.save(
            updateApplyAmount(table.rows, "one", "appliedAmount", 0.01, 2)
          )
        ).toEqual([
          expect.objectContaining({ appliedAmount: 0.01, sourceAmount: 160 })
        ]);
      }
    );

    it.each(["discountAmount", "writeOffAmount"] as const)(
      "a zero %s edit does not promote a partial 160.00 to full relief",
      (field) => {
        const table = highRate({ existingApplications: [saved(160)] });
        expect(
          table.save(updateApplyAmount(table.rows, "one", field, 0, 2))
        ).toEqual([
          expect.objectContaining({ appliedAmount: 0.01, sourceAmount: 160 })
        ]);
      }
    );

    it.each(["select", "autoApply"] as const)(
      "%s keeps all 160.01 document units for a full application",
      (action) => {
        const table = highRate();
        const rows =
          action === "select" ? table.select("one") : table.autoApply();
        expect(table.save(rows)).toEqual([
          expect.objectContaining({ appliedAmount: 0.01, sourceAmount: 160.01 })
        ]);
      }
    );

    it.each([
      ["select", 16000],
      ["autoApply", 16000],
      ["autoApply", 100000]
    ] as const)(
      "%s at %s keeps the last document cent when its carrying base is zero",
      (action, rate) => {
        const table = highRate({
          paymentExchangeRate: rate,
          priorSources: [
            {
              paymentId: "prior",
              postingDate: "2026-09-01",
              exchangeRate: rate,
              remainingDocument: 0.01,
              remainingBase: 0
            }
          ],
          openInvoices: [
            invoice({ exchangeRate: rate, balance: 0, remainingDocument: 0.01 })
          ]
        });
        const rows =
          action === "select" ? table.select("one") : table.autoApply();
        expect(table.save(rows)).toEqual([
          expect.objectContaining({ appliedAmount: 0, sourceAmount: 0.01 })
        ]);
      }
    );
  });

  describe("customer deposits fund only their own document", () => {
    const ra1 = {
      type: "rentalAgreement" as const,
      id: "ra-1",
      readableId: "RA000001"
    };
    const deposits = (overrides: Partial<Setup> = {}) =>
      base({
        paymentTotal: 0,
        priorSources: [
          {
            paymentId: "deposit",
            postingDate: "2026-09-01",
            exchangeRate: 1.2,
            remainingDocument: 60,
            remainingBase: 50,
            scope: ra1
          }
        ],
        openInvoices: [
          invoice({ rentalAgreementIds: ["ra-3"] }),
          { ...two, rentalAgreementIds: ["ra-1"] }
        ],
        ...overrides
      });

    it("auto applies a deposit only to its agreement's invoice", () => {
      const table = deposits();
      expect(table.save(table.autoApply())).toEqual([
        expect.objectContaining({
          targetSalesInvoiceId: "two",
          appliedAmount: 50,
          sourceAmount: 60
        })
      ]);
    });

    it("draws nothing from the deposit for another document's invoice", () => {
      const table = deposits();
      expect(table.save(table.select("two", table.select("one")))).toEqual([
        expect.objectContaining({
          targetSalesInvoiceId: "two",
          sourceAmount: 60
        })
      ]);
    });

    it("lists only the deposit payment's own invoices", () => {
      expect(
        deposits({
          priorSources: [],
          paymentTotal: 170,
          paymentScope: ra1
        }).rows.map((r) => r.id)
      ).toEqual(["two"]);
    });

    it("still lists another document's invoice it is applied to, and refuses it", () => {
      const table = deposits({
        priorSources: [],
        paymentTotal: 170,
        paymentScope: ra1,
        existingApplications: [
          {
            targetSalesInvoiceId: "one",
            targetPurchaseInvoiceId: null,
            appliedAmount: 100,
            discountAmount: 0,
            writeOffAmount: 0,
            sourceAmount: 110,
            targetExchangeRate: 1.1,
            sourceExchangeRate: 1.2,
            appliedDate: TODAY
          }
        ]
      });
      expect(table.rows.map((r) => [r.id, r.checked])).toEqual([
        ["one", true],
        ["two", false]
      ]);
      expect(() =>
        allocatePaymentFunding({
          ...table.funding,
          isAR: true,
          requests: fundingRequests(table.rows)
        })
      ).toThrow(/RA000001/);
    });
  });
});

describe("apply available credits", () => {
  // A 160.01 EUR credit carried at 0.01 USD, against an invoice of the same size.
  const credit = (
    exchangeRate: number,
    remaining: number,
    remainingDocument: number
  ) => ({
    id: "m",
    memoId: "CM1",
    direction: "Credit",
    currencyCode: "EUR",
    exchangeRate,
    remaining,
    remainingDocument
  });
  const openInvoice = (
    exchangeRate: number,
    balance: number,
    remainingDocument: number
  ) => ({
    id: "i",
    invoiceId: "INV",
    exchangeRate,
    balance,
    remainingDocument
  });

  it("resaves a staged document cent whose base amount is zero", () => {
    const staged = [
      { memoId: "m", invoiceId: "i", amount: 0, sourceAmount: 0.01 }
    ];
    expect(
      buildCreditApplications(
        seedCreditRows(
          [credit(100000, 0, 0.01)],
          [openInvoice(100000, 0, 0.01)],
          staged,
          2
        )
      )
    ).toEqual(staged);
  });

  it.each([
    ["a new draft", []],
    [
      "a reopened full application",
      [{ memoId: "m", invoiceId: "i", amount: 0.01, sourceAmount: 160.01 }]
    ]
  ])(
    "converts a typed 0.01 base to 160.00 document units on %s",
    (_draft, staged) => {
      const rows = seedCreditRows(
        [credit(16000, 0.01, 160.01)],
        [openInvoice(16000, 0.01, 160.01)],
        staged,
        2
      );
      expect(
        buildCreditApplications(updateCreditAmount(rows, "m", 0.01, 2))
      ).toEqual([
        { memoId: "m", invoiceId: "i", amount: 0.01, sourceAmount: 160 }
      ]);
    }
  );

  it("selecting a credit that clears the invoice keeps the exact document remainder", () => {
    const invoices = [openInvoice(16000, 0.01, 160.01)];
    const rows = seedCreditRows([credit(16000, 0.01, 160.01)], invoices, [], 2);
    expect(
      buildCreditApplications(
        toggleCreditRow(
          rows,
          "m",
          true,
          new Map(invoices.map((i) => [i.id, i]))
        )
      )
    ).toEqual([
      { memoId: "m", invoiceId: "i", amount: 0.01, sourceAmount: 160.01 }
    ]);
  });
});

describe("applications history", () => {
  const split = (overrides: Partial<PaymentApplication>) =>
    ({
      id: "a",
      targetSalesInvoiceId: "one",
      targetPurchaseInvoiceId: null,
      targetMemoId: null,
      targetReimbursementId: null,
      appliedAmount: 40,
      discountAmount: 0,
      writeOffAmount: 0,
      sourceAmount: 44,
      sourcePaymentId: null,
      targetExchangeRate: 1.1,
      sourceExchangeRate: 1.2,
      fxGainLossAmount: -3.33333,
      appliedDate: "2026-09-07",
      ...overrides
    }) as PaymentApplication;

  // 44 EUR of this payment plus 66 EUR drawn from a prior receipt, both on INV1.
  const splits = [
    split({}),
    split({
      id: "b",
      appliedAmount: 60,
      sourceAmount: 66,
      sourcePaymentId: "prior",
      sourceExchangeRate: 1.1,
      fxGainLossAmount: 0
    })
  ];

  it("shows one row per invoice with its splits summed", () => {
    expect(aggregateApplications(splits)).toEqual([
      {
        ...splits[0],
        appliedAmount: 100,
        sourceAmount: 110,
        fxGainLossAmount: -3.33333,
        sourceRates: [1.2, 1.1]
      }
    ]);
  });

  it("counts only this payment's own cash against its unapplied amount", () => {
    expect(unappliedPaymentCash(44, splits)).toBe(0);
  });
});
