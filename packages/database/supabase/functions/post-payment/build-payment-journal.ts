// Pure construction of the GL journal for posting an AR/AP payment. No DB, no
// I/O, no clock — so it is unit-testable with `deno test`. The driver
// (`index.ts`) resolves the account ids, dimensions, accounting period and
// `journalLineReference` (all impure), then hands them here to compute the
// balanced double-entry. Keeping this pure is what lets the golden-master tests
// pin the exact journal for every AR/AP × partial/full × discount/write-off ×
// FX-gain/loss × unapplied-credit permutation — the lines that hit the general
// ledger must be provably correct, not merely inspected.
//
// TWO independent axes (decoupled so REFUNDS work — a refund is cash flowing the
// "wrong" way for its ledger):
//   * isAR   — does this payment settle AR (customer) or AP (supplier)? Drives
//              account SELECTION (receivables vs payables, customer vs supplier
//              discount/write-off) and the realized-FX gain/loss DIRECTION.
//   * cashIn — does cash come INTO our bank (Receipt) or leave it (Disbursement)?
//              Drives the debit/credit SIDE of every line.
// Normal receipt: isAR && cashIn. Normal disbursement: !isAR && !cashIn.
// AR refund (cash out to a customer against a credit memo): isAR && !cashIn.
// AP refund (cash in from a supplier against a debit memo): !isAR && cashIn.
//
// Posting model (all amounts converted to base currency):
//   1) Cash      — DR Bank (cashIn) / CR Bank (!cashIn) for the full cash.
//   2) Per app   — control account (AR/AP) at the TARGET rate so it reverses the
//                  original booking exactly; discount and write-off (also
//                  invoice-currency reliefs) at the target rate; realized FX on
//                  the cash-settled principal accumulated for a single plug.
//   3) Unapplied — cash beyond what was applied becomes new on-account credit;
//                  applying more than the cash draws down existing credit (the
//                  inverse posting side).
//   4) FX plug   — one Realized FX Gain / Loss line for the accumulated FX.
//
// FX sign convention: `totalFxImpact` is normalized by the (isAR ? 1 : -1)
// factor so a POSITIVE value ALWAYS means a gain and a NEGATIVE value ALWAYS
// means a loss, for both AR and AP. This is the same quantity the stored
// `invoiceSettlement.fxGainLossAmount` captures, so the subledger reconciles.

import { credit, debit } from "../lib/utils.ts";

// A journal line this builder emits. Deliberately self-contained — a pure unit
// shouldn't depend on the generated DB types, and `journalLine.documentType`'s
// "Payment" enum value (migration 20260628143012) isn't in the generated
// lib/types.ts until the DB is rebuilt and `db:types` is regenerated. The driver
// spreads `journalId` on before the Kysely insert.
export interface PaymentJournalLine {
  accountId: string;
  description: string;
  amount: number;
  quantity: number;
  documentType: "Payment";
  documentId: string;
  documentLineReference?: string;
  journalLineReference: string;
  companyId: string;
}

// Round to 4 decimal places to match NUMERIC(19,4) storage and prevent
// floating-point cruft from making the journal fail its balance check. Shared
// with the driver so amounts are rounded identically everywhere.
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface PaymentJournalApplicationInput {
  targetSalesInvoiceId?: string | null;
  targetPurchaseInvoiceId?: string | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  targetExchangeRate: number;
  sourceExchangeRate: number;
}

export interface PaymentJournalAccounts {
  controlAccountId: string | null;
  discountAccountId: string | null;
  writeOffAccountId: string | null;
  fxGainAccountId: string | null;
  fxLossAccountId: string | null;
}

export interface BuildPaymentJournalInput {
  // Internal payment record id — becomes `documentId` on every line.
  paymentId: string;
  companyId: string;
  // See the two-axis note at the top of the file.
  isAR: boolean;
  cashIn: boolean;
  totalAmount: number;
  exchangeRate: number;
  bankAccount: string;
  // Resolved once by the driver (nanoid) so this stays pure.
  journalLineReference: string;
  applications: PaymentJournalApplicationInput[];
  accounts: PaymentJournalAccounts;
}

export interface BuildPaymentJournalResult {
  lines: PaymentJournalLine[];
  // Running debit(+)/credit(−) balance; ~0 for a balanced entry.
  signedDebitTotal: number;
  // Accumulated realized FX in base currency (+gain / −loss). Mirrors the sum of
  // the applications' stored fxGainLossAmount.
  totalFxImpact: number;
}

// Maximum residual (base ccy) we tolerate before refusing to post. Above this a
// logic/rounding bug has produced an unbalanced entry.
const BALANCE_TOLERANCE = 0.01;

export function buildPaymentJournal(
  input: BuildPaymentJournalInput
): BuildPaymentJournalResult {
  const {
    paymentId,
    companyId,
    isAR,
    cashIn,
    totalAmount,
    exchangeRate,
    bankAccount,
    journalLineReference,
    applications,
    accounts,
  } = input;

  const {
    controlAccountId,
    discountAccountId,
    writeOffAccountId,
    fxGainAccountId,
    fxLossAccountId,
  } = accounts;

  if (!controlAccountId) {
    throw new Error(
      `Missing ${isAR ? "receivables" : "payables"} account default; cannot post payment to GL`
    );
  }

  const lines: PaymentJournalLine[] = [];
  // True debit(+)/credit(−) space. A balanced double entry sums to ~0 here. (The
  // stored `amount` is natural-balance signed — credit("asset") is negative — so
  // it does NOT sum to zero; we track debit/credit balance separately.)
  let signedDebitTotal = 0;

  const pushLine = (
    side: "debit" | "credit",
    accountType: "asset" | "liability" | "equity" | "revenue" | "expense",
    magnitude: number,
    fields: {
      accountId: string;
      description: string;
      documentLineReference?: string;
    }
  ) => {
    signedDebitTotal += side === "debit" ? magnitude : -magnitude;
    lines.push({
      accountId: fields.accountId,
      description: fields.description,
      amount:
        side === "debit"
          ? debit(accountType, magnitude)
          : credit(accountType, magnitude),
      quantity: 1,
      documentType: "Payment",
      documentId: paymentId,
      documentLineReference: fields.documentLineReference,
      journalLineReference,
      companyId,
    });
  };

  // 1) Cash: DR Bank (cash in) / CR Bank (cash out), full cash in base.
  const cashBase = round4(totalAmount * exchangeRate);
  pushLine(cashIn ? "debit" : "credit", "asset", cashBase, {
    accountId: bankAccount,
    description: "Bank / Cash",
  });

  // 2) Per application: control at TARGET rate; discount / write-off at target
  //    rate. FX is accumulated and plugged once below.
  let totalFxImpact = 0; // base ccy; +ve = gain, −ve = loss (both AR and AP)
  for (const app of applications) {
    const invId = (isAR
      ? app.targetSalesInvoiceId
      : app.targetPurchaseInvoiceId) as string;
    const applied = Number(app.appliedAmount);
    const discount = Number(app.discountAmount);
    const writeOff = Number(app.writeOffAmount);
    const invRate = Number(app.targetExchangeRate);
    const payRate = Number(app.sourceExchangeRate);

    // Control account (AR/AP): at target rate (mirrors the original booking).
    // Side follows the cash direction so it offsets the bank line.
    pushLine(
      cashIn ? "credit" : "debit",
      isAR ? "asset" : "liability",
      round4((applied + discount + writeOff) * invRate),
      {
        accountId: controlAccountId,
        description: isAR ? "Accounts Receivable" : "Accounts Payable",
        documentLineReference: invId,
      }
    );

    // Discount: at TARGET rate (an invoice-currency relief, not cash, so it
    // carries no FX). AR debits (forgone revenue); AP credits (vendor allowance
    // reduces our cost).
    if (discount > 0) {
      if (!discountAccountId) {
        throw new Error(
          `Missing ${isAR ? "customer" : "supplier"} payment discount account default`
        );
      }
      pushLine(cashIn ? "debit" : "credit", "expense", round4(discount * invRate), {
        accountId: discountAccountId,
        description: isAR
          ? "Customer Payment Discount"
          : "Supplier Payment Discount",
        documentLineReference: invId,
      });
    }

    // Write-off: at TARGET rate (an invoice-currency relief, not cash, so it
    // carries no FX). AR is bad debt (expense); AP is vendor write-off (income —
    // class=Revenue).
    if (writeOff > 0) {
      if (!writeOffAccountId) {
        throw new Error(
          `Missing ${isAR ? "customer" : "supplier"} write-off account default`
        );
      }
      pushLine(
        cashIn ? "debit" : "credit",
        isAR ? "expense" : "revenue",
        round4(writeOff * invRate),
        {
          accountId: writeOffAccountId,
          description: isAR ? "Bad Debt Expense" : "Vendor Write-Off Income",
          documentLineReference: invId,
        }
      );
    }

    // Realized FX on the cash-settled principal only: applied × (sourceRate −
    // targetRate). Discount and write-off are invoice-currency reliefs booked at
    // the target rate above, so they carry no FX. The (isAR ? 1 : −1) factor
    // normalizes the sign so +ve is always a gain. Matches the stored
    // invoiceSettlement.fxGainLossAmount so the subledger reconciles.
    totalFxImpact += (isAR ? 1 : -1) * applied * (payRate - invRate);
  }

  // 3) Unapplied cash → control account (no invoice anchor), payment rate.
  //    Positive: cash beyond what was applied becomes new on-account credit.
  //    Negative: this payment applied more than its cash, drawing down the
  //    party's existing on-account credit (the inverse posting side).
  const unappliedInPaymentCcy =
    totalAmount - applications.reduce((sum, a) => sum + Number(a.appliedAmount), 0);
  if (Math.abs(unappliedInPaymentCcy) > 0.0001) {
    const buildingCredit = unappliedInPaymentCcy > 0;
    pushLine(
      cashIn === buildingCredit ? "credit" : "debit",
      isAR ? "asset" : "liability",
      round4(Math.abs(unappliedInPaymentCcy) * exchangeRate),
      {
        accountId: controlAccountId,
        description: isAR
          ? buildingCredit
            ? "Accounts Receivable (on-account credit)"
            : "Accounts Receivable (credit applied)"
          : buildingCredit
            ? "Accounts Payable (on-account credit)"
            : "Accounts Payable (credit applied)",
      }
    );
  }

  // 4) FX plug (single line).
  if (Math.abs(totalFxImpact) > 0.0001) {
    const fxBase = round4(Math.abs(totalFxImpact));
    if (totalFxImpact > 0) {
      if (!fxGainAccountId) {
        throw new Error("Missing realized FX gain account default");
      }
      pushLine("credit", "revenue", fxBase, {
        accountId: fxGainAccountId,
        description: "Realized FX Gain",
      });
    } else {
      if (!fxLossAccountId) {
        throw new Error("Missing realized FX loss account default");
      }
      pushLine("debit", "expense", fxBase, {
        accountId: fxLossAccountId,
        description: "Realized FX Loss",
      });
    }
  }

  // Self-check: the entry must balance in true debit/credit space. The FX plug
  // (same formula as the stored fxGainLossAmount) should make this ~0; a larger
  // residual means a logic/rounding bug, so we refuse to post rather than write
  // an unbalanced journal to the GL.
  if (Math.abs(signedDebitTotal) > BALANCE_TOLERANCE) {
    throw new Error(
      `Payment journal does not balance (off by ${round4(signedDebitTotal)} in base currency); refusing to post`
    );
  }

  return { lines, signedDebitTotal, totalFxImpact };
}
