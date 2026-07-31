import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildPaymentJournal,
  type BuildPaymentJournalInput,
  type PaymentJournalAccounts,
} from "./build-payment-journal.ts";

// Golden-master tests for the GL journal a payment posts. Each asserts the exact
// natural-balance-signed `amount` on each line (asset/expense debits are +,
// credits −; liability/revenue/equity are the mirror — see lib/utils.ts) AND
// that the entry balances in debit/credit space (signedDebitTotal ≈ 0). The
// matrix covers AR/AP × full/partial/over × discount/write-off × FX gain/loss,
// so the ledger that hits the books is provably correct, not merely inspected.
//
// Convention: exchange rates are FOREIGN units per BASE unit (targetExchangeRate
// = invoice rate, sourceExchangeRate = payment rate). The stored settlement
// amounts (appliedAmount / discountAmount / writeOffAmount) and totalAmount are
// ALREADY base currency, so control / discount / write-off / unapplied post RAW.
// A settled principal booked to control at its base value at the invoice rate
// (= appliedAmount) settles for appliedAmount × invRate/payRate base at the
// payment rate; the difference is the realized FX. So a LOWER payment rate than
// the invoice rate (the foreign currency strengthened) is an AR gain, and a
// HIGHER payment rate (it weakened) is an AR loss — the mirror for AP.

const ACCOUNTS: PaymentJournalAccounts = {
  controlAccountId: "control", // receivables (AR) or payables (AP); driver resolves
  discountAccountId: "discount",
  writeOffAccountId: "writeoff",
  fxGainAccountId: "fxgain",
  fxLossAccountId: "fxloss",
};

const arBase = (
  over: Partial<BuildPaymentJournalInput> = {}
): BuildPaymentJournalInput => ({
  paymentId: "pay_1",
  companyId: "co_1",
  isAR: true,
  cashIn: true,
  totalAmount: 100,
  exchangeRate: 1,
  bankAccount: "bank",
  journalLineReference: "ref_1",
  applications: [
    {
      targetSalesInvoiceId: "si_1",
      appliedAmount: 100,
      discountAmount: 0,
      writeOffAmount: 0,
      targetExchangeRate: 1,
      sourceExchangeRate: 1,
    },
  ],
  accounts: { ...ACCOUNTS },
  ...over,
});

const apBase = (
  over: Partial<BuildPaymentJournalInput> = {}
): BuildPaymentJournalInput => ({
  ...arBase(),
  isAR: false,
  cashIn: false,
  applications: [
    {
      targetPurchaseInvoiceId: "pi_1",
      appliedAmount: 100,
      discountAmount: 0,
      writeOffAmount: 0,
      targetExchangeRate: 1,
      sourceExchangeRate: 1,
    },
  ],
  ...over,
});

const balanced = (signedDebitTotal: number) =>
  Math.abs(signedDebitTotal) < 1e-9;

const line = <T extends { description: string }>(
  lines: T[],
  description: string
) => lines.find((l) => l.description === description);

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Magnitude posted to the control account for a specific invoice (the lines are
// natural-balance signed, so take the absolute value to compare to the
// subledger settled amount).
const controlMagnitudeFor = (
  lines: { description: string; documentLineReference?: string; amount: number }[],
  invoiceId: string
) => {
  const l = lines.find(
    (x) =>
      (x.description === "Accounts Receivable" ||
        x.description === "Accounts Payable") &&
      x.documentLineReference === invoiceId
  );
  return l ? Math.abs(l.amount) : 0;
};

// ---------------------------------------------------------------------------
// Simple, no-FX cases — assert the full line set.
// ---------------------------------------------------------------------------

Deno.test("AR full payment, no FX: DR bank / CR receivables, balanced", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(arBase());

  assertEquals(lines.length, 2);
  assertEquals(lines[0].accountId, "bank");
  assertEquals(lines[0].amount, 100); // debit asset
  assertEquals(lines[0].description, "Bank / Cash");
  assertEquals(lines[0].documentType, "Payment");
  assertEquals(lines[0].documentId, "pay_1");
  assertEquals(lines[0].journalLineReference, "ref_1");
  assertEquals(lines[0].companyId, "co_1");

  assertEquals(lines[1].accountId, "control");
  assertEquals(lines[1].amount, -100); // credit asset
  assertEquals(lines[1].description, "Accounts Receivable");
  assertEquals(lines[1].documentLineReference, "si_1");

  assert(balanced(signedDebitTotal));
});

Deno.test("AP full payment, no FX: CR bank / DR payables, balanced", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(apBase());

  assertEquals(lines.length, 2);
  assertEquals(lines[0].accountId, "bank");
  assertEquals(lines[0].amount, -100); // credit asset
  assertEquals(lines[1].accountId, "control");
  assertEquals(lines[1].amount, -100); // debit liability → natural-negative
  assertEquals(lines[1].description, "Accounts Payable");
  assertEquals(lines[1].documentLineReference, "pi_1");

  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Discount / write-off — invoice-currency reliefs, no FX.
// ---------------------------------------------------------------------------

Deno.test("AR discount: bank 90 / receivables 100 / discount expense 10", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      totalAmount: 90,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 90,
          discountAmount: 10,
          writeOffAmount: 0,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, 90);
  assertEquals(line(lines, "Accounts Receivable")!.amount, -100); // 90+10
  const discount = line(lines, "Customer Payment Discount")!;
  assertEquals(discount.accountId, "discount");
  assertEquals(discount.amount, 10); // debit expense
  assert(balanced(signedDebitTotal));
});

Deno.test("AR write-off: bad debt expense debited", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      totalAmount: 90,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 90,
          discountAmount: 0,
          writeOffAmount: 10,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
        },
      ],
    })
  );

  const wo = line(lines, "Bad Debt Expense")!;
  assertEquals(wo.accountId, "writeoff");
  assertEquals(wo.amount, 10); // debit expense
  assert(balanced(signedDebitTotal));
});

Deno.test("AP write-off: vendor write-off income credited (revenue)", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    apBase({
      totalAmount: 90,
      applications: [
        {
          targetPurchaseInvoiceId: "pi_1",
          appliedAmount: 90,
          discountAmount: 0,
          writeOffAmount: 10,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
        },
      ],
    })
  );

  const wo = line(lines, "Vendor Write-Off Income")!;
  assertEquals(wo.accountId, "writeoff");
  assertEquals(wo.amount, 10); // credit revenue → natural-positive
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Realized FX — the sign convention under foreign-per-base rates. A settled
// principal is booked to control at appliedAmount (its base value at the invoice
// rate) and settles for appliedAmount × invRate/payRate base. AR collecting when
// the foreign currency STRENGTHENED (payRate < invRate) is a gain; when it
// WEAKENED (payRate > invRate) a loss. AP is the mirror.
// ---------------------------------------------------------------------------

Deno.test("AR foreign strengthened (payRate < invRate) → FX Gain (credit revenue)", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      exchangeRate: 0.8,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 100,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 0.8,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, 125); // 100 × 1.0/0.8
  assertEquals(line(lines, "Accounts Receivable")!.amount, -100); // raw base
  const fx = line(lines, "Realized FX Gain")!;
  assertEquals(fx.accountId, "fxgain");
  assertEquals(fx.amount, 25); // credit revenue: 100 × (1.0/0.8 − 1)
  assert(line(lines, "Realized FX Loss") === undefined);
  assert(balanced(signedDebitTotal));
});

Deno.test("AR foreign weakened (payRate > invRate) → FX Loss (debit expense)", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      exchangeRate: 1.25,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 100,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 1.25,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, 80); // 100 × 1.0/1.25
  const fx = line(lines, "Realized FX Loss")!;
  assertEquals(fx.accountId, "fxloss");
  assertEquals(fx.amount, 20); // debit expense: 100 × (1 − 1.0/1.25)
  assert(line(lines, "Realized FX Gain") === undefined);
  assert(balanced(signedDebitTotal));
});

Deno.test("AP foreign strengthened (payRate < invRate) → FX Loss (debit expense)", () => {
  // Paying a supplier when the foreign currency strengthened costs more base
  // than the liability was booked at — a real loss.
  const { lines, signedDebitTotal } = buildPaymentJournal(
    apBase({
      exchangeRate: 0.8,
      applications: [
        {
          targetPurchaseInvoiceId: "pi_1",
          appliedAmount: 100,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 0.8,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, -125); // credit asset 100×1.0/0.8
  const fx = line(lines, "Realized FX Loss")!;
  assertEquals(fx.accountId, "fxloss");
  assertEquals(fx.amount, 25); // debit expense
  assert(line(lines, "Realized FX Gain") === undefined);
  assert(balanced(signedDebitTotal));
});

Deno.test("AP foreign weakened (payRate > invRate) → FX Gain (credit revenue)", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    apBase({
      exchangeRate: 1.25,
      applications: [
        {
          targetPurchaseInvoiceId: "pi_1",
          appliedAmount: 100,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 1.25,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, -80); // credit asset 100×1.0/1.25
  const fx = line(lines, "Realized FX Gain")!;
  assertEquals(fx.accountId, "fxgain");
  assertEquals(fx.amount, 20); // credit revenue
  assert(line(lines, "Realized FX Loss") === undefined);
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Unapplied cash — building vs drawing down on-account credit.
// ---------------------------------------------------------------------------

Deno.test("AR partial: unapplied cash builds on-account credit", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      totalAmount: 100,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 60,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, 100);
  assertEquals(line(lines, "Accounts Receivable")!.amount, -60);
  const credit = line(lines, "Accounts Receivable (on-account credit)")!;
  assertEquals(credit.amount, -40); // credit asset (no invoice anchor)
  assertEquals(credit.documentLineReference, undefined);
  assert(balanced(signedDebitTotal));
});

Deno.test("AR over-application draws down existing credit (inverse side)", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      totalAmount: 80,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 100,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, 80);
  assertEquals(line(lines, "Accounts Receivable")!.amount, -100);
  const draw = line(lines, "Accounts Receivable (credit applied)")!;
  assertEquals(draw.amount, 20); // debit asset — inverse of building credit
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Multi-invoice + combined relief still balances.
// ---------------------------------------------------------------------------

Deno.test("AR two invoices with discount and FX all balance", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      exchangeRate: 1.1,
      totalAmount: 190,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 100,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 1.1,
        },
        {
          targetSalesInvoiceId: "si_2",
          appliedAmount: 90,
          discountAmount: 10,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 1.1,
        },
      ],
    })
  );

  // Two control lines, one discount, one FX loss (payRate > invRate), cash — and
  // it balances.
  assert(line(lines, "Customer Payment Discount") !== undefined);
  assert(line(lines, "Realized FX Loss") !== undefined);
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Refusal paths — missing account defaults and an unbalanced entry.
// ---------------------------------------------------------------------------

Deno.test("throws when the control account default is missing", () => {
  assertThrows(
    () =>
      buildPaymentJournal(
        arBase({ accounts: { ...ACCOUNTS, controlAccountId: null } })
      ),
    Error,
    "receivables account default"
  );
});

Deno.test("throws when a discount is taken but no discount account is set", () => {
  assertThrows(
    () =>
      buildPaymentJournal(
        arBase({
          totalAmount: 90,
          accounts: { ...ACCOUNTS, discountAccountId: null },
          applications: [
            {
              targetSalesInvoiceId: "si_1",
              appliedAmount: 90,
              discountAmount: 10,
              writeOffAmount: 0,
              targetExchangeRate: 1,
              sourceExchangeRate: 1,
            },
          ],
        })
      ),
    Error,
    "payment discount account default"
  );
});

Deno.test("throws when an FX gain arises but no FX gain account is set", () => {
  assertThrows(
    () =>
      buildPaymentJournal(
        arBase({
          exchangeRate: 0.8,
          accounts: { ...ACCOUNTS, fxGainAccountId: null },
          applications: [
            {
              targetSalesInvoiceId: "si_1",
              appliedAmount: 100,
              discountAmount: 0,
              writeOffAmount: 0,
              targetExchangeRate: 1.0,
              sourceExchangeRate: 0.8, // payRate < invRate → AR gain
            },
          ],
        })
      ),
    Error,
    "realized FX gain account default"
  );
});

Deno.test("throws when a write-off arises but no write-off account is set", () => {
  assertThrows(
    () =>
      buildPaymentJournal(
        apBase({
          totalAmount: 90,
          accounts: { ...ACCOUNTS, writeOffAccountId: null },
          applications: [
            {
              targetPurchaseInvoiceId: "pi_1",
              appliedAmount: 90,
              discountAmount: 0,
              writeOffAmount: 10,
              targetExchangeRate: 1,
              sourceExchangeRate: 1,
            },
          ],
        })
      ),
    Error,
    "write-off account default"
  );
});

// ---------------------------------------------------------------------------
// No applications — a pure prepayment / on-account receipt or supplier advance.
// ---------------------------------------------------------------------------

Deno.test("AR prepayment with no applications: cash + full on-account credit", () => {
  const { lines, signedDebitTotal, totalFxImpact } = buildPaymentJournal(
    arBase({ totalAmount: 250, applications: [] })
  );

  assertEquals(lines.length, 2);
  assertEquals(line(lines, "Bank / Cash")!.amount, 250); // debit asset
  const credit = line(lines, "Accounts Receivable (on-account credit)")!;
  assertEquals(credit.amount, -250); // credit asset, no invoice anchor
  assertEquals(credit.documentLineReference, undefined);
  assertEquals(totalFxImpact, 0);
  assert(balanced(signedDebitTotal));
});

Deno.test("AP advance with no applications: CR bank + on-account credit", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    apBase({ totalAmount: 250, applications: [] })
  );

  assertEquals(lines.length, 2);
  assertEquals(line(lines, "Bank / Cash")!.amount, -250); // credit asset
  assert(line(lines, "Accounts Payable (on-account credit)") !== undefined);
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Unapplied threshold — the 0.0001 dust band must not emit a spurious line.
// ---------------------------------------------------------------------------

Deno.test("applied exactly equal to cash emits no unapplied line", () => {
  const { lines } = buildPaymentJournal(arBase());
  assert(line(lines, "Accounts Receivable (on-account credit)") === undefined);
  assert(line(lines, "Accounts Receivable (credit applied)") === undefined);
});

Deno.test("sub-dust unapplied (< 0.0001) emits no on-account line", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      totalAmount: 100,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 99.99995, // unapplied 0.00005 < threshold
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
        },
      ],
    })
  );
  assert(line(lines, "Accounts Receivable (on-account credit)") === undefined);
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Multiple invoices — full settlement, over-application, under-application.
// ---------------------------------------------------------------------------

Deno.test("AR three invoices fully settled: one cash + three control lines", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      totalAmount: 60,
      applications: [
        { targetSalesInvoiceId: "si_1", appliedAmount: 10, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1, sourceExchangeRate: 1 },
        { targetSalesInvoiceId: "si_2", appliedAmount: 20, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1, sourceExchangeRate: 1 },
        { targetSalesInvoiceId: "si_3", appliedAmount: 30, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1, sourceExchangeRate: 1 },
      ],
    })
  );

  assertEquals(lines.filter((l) => l.description === "Accounts Receivable").length, 3);
  assertEquals(line(lines, "Bank / Cash")!.amount, 60);
  assert(line(lines, "Accounts Receivable (on-account credit)") === undefined);
  assertEquals(controlMagnitudeFor(lines, "si_1"), 10);
  assertEquals(controlMagnitudeFor(lines, "si_2"), 20);
  assertEquals(controlMagnitudeFor(lines, "si_3"), 30);
  assert(balanced(signedDebitTotal));
});

Deno.test("AR overpayment across multiple invoices: single draw-down line", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      totalAmount: 150,
      applications: [
        { targetSalesInvoiceId: "si_1", appliedAmount: 100, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1, sourceExchangeRate: 1 },
        { targetSalesInvoiceId: "si_2", appliedAmount: 80, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1, sourceExchangeRate: 1 },
      ],
    })
  );

  // applied 180 vs cash 150 → 30 drawn from existing credit (inverse side).
  const draw = line(lines, "Accounts Receivable (credit applied)")!;
  assertEquals(draw.amount, 30); // debit asset
  assertEquals(lines.filter((l) => l.description === "Accounts Receivable (on-account credit)").length, 0);
  assert(balanced(signedDebitTotal));
});

Deno.test("AP underpayment across multiple invoices builds credit", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    apBase({
      totalAmount: 200,
      applications: [
        { targetPurchaseInvoiceId: "pi_1", appliedAmount: 60, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1, sourceExchangeRate: 1 },
        { targetPurchaseInvoiceId: "pi_2", appliedAmount: 60, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1, sourceExchangeRate: 1 },
      ],
    })
  );

  // 200 cash − 120 applied → 80 on-account credit.
  const credit = line(lines, "Accounts Payable (on-account credit)")!;
  assertEquals(Math.abs(credit.amount), 80);
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Combined relief + FX on the same application.
// ---------------------------------------------------------------------------

Deno.test("AR discount + write-off + FX on one invoice all coexist, balanced", () => {
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      exchangeRate: 0.8,
      totalAmount: 80, // pays 80 base applied; 10 discount + 10 write-off settle a 100 invoice
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 80,
          discountAmount: 10,
          writeOffAmount: 10,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 0.8, // payRate < invRate → AR gain
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, 100); // 80 × 1.0/0.8
  assertEquals(line(lines, "Accounts Receivable")!.amount, -100); // 80+10+10 raw
  assertEquals(line(lines, "Customer Payment Discount")!.amount, 10); // raw
  assertEquals(line(lines, "Bad Debt Expense")!.amount, 10); // raw
  assertEquals(line(lines, "Realized FX Gain")!.amount, 20); // 80 × (1.0/0.8 − 1)
  assert(balanced(signedDebitTotal));
});

Deno.test("FX accrues on applied principal only, never on discount/write-off", () => {
  // Pure discount settlement with a rate gap: applied 0 ⇒ no FX line at all.
  const { lines, totalFxImpact } = buildPaymentJournal(
    arBase({
      totalAmount: 0,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 0,
          discountAmount: 50,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 1.5,
        },
      ],
    })
  );

  assertEquals(totalFxImpact, 0);
  assert(line(lines, "Realized FX Gain") === undefined);
  assert(line(lines, "Realized FX Loss") === undefined);
});

Deno.test("opposing per-invoice FX nets to zero → no FX plug line", () => {
  const { lines, signedDebitTotal, totalFxImpact } = buildPaymentJournal(
    arBase({
      exchangeRate: 1.0,
      totalAmount: 225,
      applications: [
        { targetSalesInvoiceId: "si_1", appliedAmount: 100, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1.0, sourceExchangeRate: 0.8 }, // 100 × (1.25 − 1) = +25
        { targetSalesInvoiceId: "si_2", appliedAmount: 125, discountAmount: 0, writeOffAmount: 0, targetExchangeRate: 1.0, sourceExchangeRate: 1.25 }, // 125 × (0.8 − 1) = −25
      ],
    })
  );

  assert(Math.abs(totalFxImpact) < 1e-9);
  assert(line(lines, "Realized FX Gain") === undefined);
  assert(line(lines, "Realized FX Loss") === undefined);
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Rounding — NUMERIC(19,4): every magnitude is rounded to 4 dp and the entry
// still balances within tolerance under messy rates.
// ---------------------------------------------------------------------------

Deno.test("magnitudes round to 4 dp and the entry still balances", () => {
  // invRate 1.0, payRate 0.9 → cash = 100 / 0.9 = 111.1111; control = 100 raw;
  // FX = 100 × (1.0/0.9 − 1) = 11.1111 → all land on 4 dp and net to zero.
  const { lines, signedDebitTotal } = buildPaymentJournal(
    arBase({
      exchangeRate: 0.9,
      totalAmount: 100,
      applications: [
        {
          targetSalesInvoiceId: "si_1",
          appliedAmount: 100,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1.0,
          sourceExchangeRate: 0.9,
        },
      ],
    })
  );

  assertEquals(line(lines, "Bank / Cash")!.amount, 111.1111);
  assertEquals(line(lines, "Accounts Receivable")!.amount, -100);
  assertEquals(line(lines, "Realized FX Gain")!.amount, 11.1111);
  assert(balanced(signedDebitTotal));
});

// ---------------------------------------------------------------------------
// Subledger tie-out — the property the SQL tie-out RPCs depend on. For every
// application, the magnitude posted to the control account equals the RAW base
// settled amount (applied + discount + write-off), so the GL reconciles to the
// subledger invoice-by-invoice.
// ---------------------------------------------------------------------------

Deno.test("control posting ties out to subledger settled per invoice (AR & AP)", () => {
  const apps = [
    { applied: 100, discount: 5, writeOff: 0, invRate: 1.0 },
    { applied: 40, discount: 0, writeOff: 10, invRate: 1.25 },
    { applied: 7.5, discount: 2.5, writeOff: 0, invRate: 0.8 },
  ];

  for (const isReceipt of [true, false]) {
    const base = isReceipt ? arBase() : apBase();
    const { lines, signedDebitTotal } = buildPaymentJournal({
      ...base,
      exchangeRate: 1.0,
      totalAmount: apps.reduce((s, a) => s + a.applied, 0),
      applications: apps.map((a, i) => ({
        [isReceipt ? "targetSalesInvoiceId" : "targetPurchaseInvoiceId"]: `inv_${i}`,
        appliedAmount: a.applied,
        discountAmount: a.discount,
        writeOffAmount: a.writeOff,
        targetExchangeRate: a.invRate,
        sourceExchangeRate: 1.0,
      })),
    });

    apps.forEach((a, i) => {
      const expected = round4(a.applied + a.discount + a.writeOff);
      assertEquals(controlMagnitudeFor(lines, `inv_${i}`), expected);
    });
    assert(balanced(signedDebitTotal));
  }
});

// ---------------------------------------------------------------------------
// Property matrix — every AR/AP × rate × relief combination must balance and
// must post the correct FX side (gain when the foreign currency strengthened
// for AR / weakened for AP, loss the other way).
// ---------------------------------------------------------------------------

Deno.test("matrix: every scenario balances with the correct FX side", () => {
  const invRates = [0.75, 1.0, 1.37];
  const payRates = [0.75, 1.0, 1.37];
  const reliefs = [
    { discount: 0, writeOff: 0 },
    { discount: 5, writeOff: 0 },
    { discount: 0, writeOff: 5 },
    { discount: 3, writeOff: 4 },
  ];

  for (const isReceipt of [true, false]) {
    for (const invRate of invRates) {
      for (const payRate of payRates) {
        for (const relief of reliefs) {
          const applied = 100;
          const base = isReceipt ? arBase() : apBase();
          const { lines, signedDebitTotal, totalFxImpact } = buildPaymentJournal({
            ...base,
            exchangeRate: payRate,
            totalAmount: applied,
            applications: [
              {
                [isReceipt ? "targetSalesInvoiceId" : "targetPurchaseInvoiceId"]: "inv",
                appliedAmount: applied,
                discountAmount: relief.discount,
                writeOffAmount: relief.writeOff,
                targetExchangeRate: invRate,
                sourceExchangeRate: payRate,
              },
            ],
          });

          assert(
            Math.abs(signedDebitTotal) < 0.01,
            `unbalanced: receipt=${isReceipt} inv=${invRate} pay=${payRate}`
          );

          const expectedFx =
            (isReceipt ? 1 : -1) * applied * (invRate / payRate - 1);
          if (Math.abs(expectedFx) > 0.0001) {
            const side = expectedFx > 0 ? "Realized FX Gain" : "Realized FX Loss";
            const wrong = expectedFx > 0 ? "Realized FX Loss" : "Realized FX Gain";
            assert(line(lines, side) !== undefined, `missing ${side}`);
            assert(line(lines, wrong) === undefined, `unexpected ${wrong}`);
          }
          assert(Math.abs(round4(totalFxImpact) - round4(expectedFx)) < 1e-9);
        }
      }
    }
  }
});
