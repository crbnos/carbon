// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure journal construction from authoritative, locked funding allocations.
// Cash/sourceAmount are document currency. Control, relief, carrying remainders,
// and the persisted per-application realized FX snapshots are company base.

import { assertExchangeRate, toBaseAmount } from "./accounting-currency.ts";
import {
  depositAppliedDescription,
  depositDescription,
  onAccountCreditDescription
} from "./accounting-posting.ts";
import { accountTypeFromClass, credit, debit } from "./ledger.ts";
import { assertBalanced, EPSILON, round } from "./precision.ts";

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

export interface PaymentJournalApplicationInput {
  targetPaymentId?: string | null;
  targetMemoId?: string | null;
  targetSalesInvoiceId?: string | null;
  targetPurchaseInvoiceId?: string | null;
  targetReimbursementId?: string | null;
  sourceAmount: number;
  sourcePaymentId: string | null;
  fxGainLossAmount: number;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  targetExchangeRate: number;
  sourceExchangeRate: number;
  /** Original booked control accounts, resolved by the locked posting driver. */
  targetControlAccountId?: string;
  sourceControlAccountId?: string;
  /** The prior credit was booked as a deposit — a customer deposit, a liability
   *  on the prepayment account, or a supplier prepayment, an asset on the
   *  supplier prepayment account — rather than on-account control credit, so
   *  its release moves that account and is described as a deposit release. The
   *  driver reads this off the source's own journal line, never off today's
   *  defaults. */
  sourceIsDeposit?: boolean;
}

export interface PaymentJournalAccounts {
  controlAccountId: string | null;
  discountAccountId: string | null;
  /** The discount account's glAccountClass. Drives the discount line's natural-
   *  balance sign so a customer discount (Revenue) debits contra-revenue and a
   *  supplier discount (Expense/COGS) credits contra-cost. Resolved by index.ts;
   *  optional so callers without a discount need not supply it (falls back to
   *  "expense" for back-compat). */
  discountAccountClass?: string | null;
  writeOffAccountId: string | null;
  fxGainAccountId: string | null;
  fxLossAccountId: string | null;
}

// A fee withheld by a payment processor BEFORE the cash reaches the bank (e.g.
// Stripe Connect's per-charge commission) — never a fee billed separately. The
// caller resolves the account (a per-integration override or the company's
// service-charge default) and converts nothing; `amount` is in the payment's
// own currency, same as `totalAmount`, and gets the same exchangeRate applied.
export interface PaymentJournalFeeInput {
  amount: number;
  accountId: string;
  description?: string;
}

export interface BuildPaymentJournalInput {
  // Internal payment record id — becomes `documentId` on every line.
  paymentId: string;
  companyId: string;
  // Party determines the control account class; cash direction determines
  // debit/credit sides independently (including reusable refund arithmetic).
  isAR: boolean;
  /** An employee reimbursement payout. Structurally the AP arm — cash out,
   *  liability control debited — with `targetReimbursementId` as the target
   *  column and the reimbursement's own booked payable account (passed per
   *  application as `targetControlAccountId`) as the control. `isAR` stays
   *  false, so every sign in this builder is already correct. */
  isReimbursement?: boolean;
  cashIn: boolean;
  totalAmount: number;
  exchangeRate: number;
  bankAccount: string;
  // Resolved once by the driver (nanoid) so this stays pure.
  journalLineReference: string;
  applications: PaymentJournalApplicationInput[];
  /** Authoritative unused current-cash carrying remainder from funding allocation. */
  newOnAccountBase: number;
  accounts: PaymentJournalAccounts;
  fee?: PaymentJournalFeeInput;
  /** A deposit: the payment references a document. A customer payment with a
   *  sales order, rental agreement or contract holds its unapplied cash as a
   *  liability on `depositAccountId` (Customer Prepayments); a supplier payment
   *  with a purchase order holds it as an asset there (Supplier Prepayments).
   *  Neither is on-account control credit. A refund releases its original
   *  advances through payment-target applications, never a new unapplied leg. */
  isDeposit?: boolean;
  depositAccountId?: string | null;
  /** Historical customer refunds predate explicit advance-consumption applications. */
  legacyCustomerDepositRefund?: boolean;
}

export interface BuildPaymentJournalResult {
  lines: PaymentJournalLine[];
  // Running debit(+)/credit(−) balance; ~0 for a balanced entry.
  signedDebitTotal: number;
  // Accumulated realized FX in base currency (+gain / −loss). Mirrors the sum of
  // the applications' stored fxGainLossAmount.
  totalFxImpact: number;
}

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and nonnegative`);
  }
  return value;
}

export function buildPaymentJournal(
  input: BuildPaymentJournalInput
): BuildPaymentJournalResult {
  const {
    paymentId,
    companyId,
    isAR,
    isReimbursement = false,
    cashIn,
    totalAmount,
    exchangeRate,
    bankAccount,
    journalLineReference,
    applications,
    accounts,
    fee,
    depositAccountId
  } = input;
  const isDeposit = Boolean(input.isDeposit);
  // A customer deposit is money owed back (liability); a supplier prepayment
  // is goods owed to us (asset).
  const depositType = isAR ? "liability" : "asset";
  if (!accounts.controlAccountId) {
    throw new Error("Missing control account default");
  }
  const grossBase = toBaseAmount(
    nonnegative(totalAmount, "Payment amount"),
    exchangeRate
  );
  const newOnAccountBase = toBaseAmount(
    nonnegative(input.newOnAccountBase, "New on-account carrying value"),
    1
  );
  if (
    fee &&
    (nonnegative(fee.amount, "Processor fee") > totalAmount || !fee.accountId)
  ) {
    throw new Error(
      "Processor fee requires an account and cannot exceed gross cash"
    );
  }
  const feeBase = fee ? toBaseAmount(fee.amount, exchangeRate) : 0;
  const lines: PaymentJournalLine[] = [];
  let signedDebitTotal = 0;
  const push = (
    side: "debit" | "credit",
    type: "asset" | "liability" | "equity" | "revenue" | "expense",
    magnitude: number,
    accountId: string | null,
    description: string,
    target?: string
  ) => {
    magnitude = toBaseAmount(nonnegative(magnitude, "Journal magnitude"), 1);
    if (magnitude === 0) return;
    if (!accountId) {
      throw new Error(`Missing account default for ${description}`);
    }
    signedDebitTotal += side === "debit" ? magnitude : -magnitude;
    lines.push({
      accountId,
      description,
      amount:
        side === "debit" ? debit(type, magnitude) : credit(type, magnitude),
      quantity: 1,
      documentType: "Payment",
      documentId: paymentId,
      documentLineReference: target,
      journalLineReference,
      companyId
    });
  };
  push(
    cashIn ? "debit" : "credit",
    "asset",
    round(grossBase - feeBase),
    bankAccount,
    "Bank / Cash"
  );
  if (fee) {
    push(
      cashIn ? "debit" : "credit",
      "expense",
      feeBase,
      fee.accountId,
      fee.description ?? "Payment Processing Fee"
    );
  }
  const legacyCustomerDepositRefund =
    input.legacyCustomerDepositRefund ?? false;
  if (
    legacyCustomerDepositRefund &&
    (!isAR ||
      !isDeposit ||
      cashIn ||
      isReimbursement ||
      applications.some((application) => application.targetPaymentId))
  ) {
    throw new Error(
      "Only historical customer deposit refunds may use legacy reconstruction"
    );
  }
  const isDepositRefund =
    isDeposit &&
    !isReimbursement &&
    cashIn !== isAR &&
    !legacyCustomerDepositRefund;
  let refundedPrincipal = 0;
  let refundedCarrying = 0;
  let totalFxImpact = 0;
  let currentCashReleased = 0;
  let currentDocumentReleased = 0;
  const priorCreditReleased = new Map<
    string,
    { amount: number; isDeposit: boolean }
  >();
  for (const app of applications) {
    if (isDepositRefund) {
      if (
        !app.targetPaymentId ||
        app.sourcePaymentId !== app.targetPaymentId ||
        app.targetPaymentId === paymentId ||
        !app.sourceControlAccountId ||
        !app.sourceIsDeposit ||
        app.targetSalesInvoiceId ||
        app.targetPurchaseInvoiceId ||
        app.targetMemoId ||
        app.targetReimbursementId ||
        app.discountAmount !== 0 ||
        app.writeOffAmount !== 0 ||
        app.fxGainLossAmount !== 0 ||
        app.sourceExchangeRate !== app.targetExchangeRate
      )
        throw new Error("Deposit refunds must consume their original advances");
      assertExchangeRate(app.sourceExchangeRate);
      refundedPrincipal += nonnegative(app.sourceAmount, "Refund principal");
      const carrying = nonnegative(app.appliedAmount, "Refund carrying value");
      if (app.sourceAmount === 0 && carrying !== 0)
        throw new Error("Zero refund principal cannot release carrying value");
      refundedCarrying += carrying;
      push(
        cashIn ? "credit" : "debit",
        depositType,
        carrying,
        app.sourceControlAccountId,
        depositAppliedDescription(isAR),
        app.targetPaymentId
      );
      continue;
    }
    if (app.targetPaymentId)
      throw new Error("Only deposit refunds can target payments");
    const isRefund = !isReimbursement && cashIn !== isAR;
    const target = isReimbursement
      ? app.targetReimbursementId
      : isRefund
        ? app.targetMemoId
        : isAR
          ? app.targetSalesInvoiceId
          : app.targetPurchaseInvoiceId;
    if (
      !target ||
      (isReimbursement
        ? // A reimbursement payout carries no other target, no prior-credit
          // funding source, and no trade discount or write-off.
          app.targetSalesInvoiceId ||
          app.targetPurchaseInvoiceId ||
          app.targetMemoId ||
          app.sourcePaymentId ||
          app.discountAmount !== 0 ||
          app.writeOffAmount !== 0
        : isRefund
          ? app.targetSalesInvoiceId ||
            app.targetPurchaseInvoiceId ||
            app.targetReimbursementId ||
            app.sourcePaymentId ||
            app.discountAmount !== 0 ||
            app.writeOffAmount !== 0
          : app.targetMemoId ||
            app.targetReimbursementId ||
            (isAR ? app.targetPurchaseInvoiceId : app.targetSalesInvoiceId))
    ) {
      throw new Error("Invalid payment application target");
    }
    assertExchangeRate(app.targetExchangeRate);
    assertExchangeRate(app.sourceExchangeRate);
    const applied = nonnegative(app.appliedAmount, "Applied amount");
    const discount = nonnegative(app.discountAmount, "Discount amount");
    const writeOff = nonnegative(app.writeOffAmount, "Write-off amount");
    nonnegative(app.sourceAmount, "Source principal");
    if (!Number.isFinite(app.fxGainLossAmount)) {
      throw new Error("Settlement FX must be finite");
    }
    const releasedBase = round(
      applied + (cashIn ? app.fxGainLossAmount : -app.fxGainLossAmount)
    );
    nonnegative(releasedBase, "Released source carrying value");
    if (
      app.sourceAmount === 0 &&
      (releasedBase !== 0 || applied !== 0 || app.fxGainLossAmount !== 0)
    ) {
      throw new Error(
        "Zero source principal cannot release carrying value or realize FX"
      );
    }
    if (app.sourcePaymentId) {
      const sourceAccount =
        app.sourceControlAccountId ?? accounts.controlAccountId;
      const sourceIsDeposit = Boolean(app.sourceIsDeposit);
      const released = priorCreditReleased.get(sourceAccount);
      if (released && released.isDeposit !== sourceIsDeposit) {
        throw new Error(
          "Funding source account holds both deposit and on-account credit"
        );
      }
      priorCreditReleased.set(sourceAccount, {
        amount: round((released?.amount ?? 0) + releasedBase),
        isDeposit: sourceIsDeposit
      });
    } else {
      if (app.sourceExchangeRate !== exchangeRate) {
        throw new Error("Current cash rate does not match payment snapshot");
      }
      currentCashReleased += releasedBase;
      currentDocumentReleased += app.sourceAmount;
    }
    push(
      cashIn ? "credit" : "debit",
      isAR ? "asset" : "liability",
      round(applied + discount + writeOff),
      app.targetControlAccountId ?? accounts.controlAccountId,
      isReimbursement
        ? "Employee Reimbursements Payable"
        : isAR
          ? "Accounts Receivable"
          : "Accounts Payable",
      target
    );
    push(
      cashIn ? "debit" : "credit",
      accounts.discountAccountClass
        ? accountTypeFromClass(accounts.discountAccountClass)
        : "expense",
      discount,
      accounts.discountAccountId,
      isAR ? "Customer Payment Discount" : "Supplier Payment Discount",
      target
    );
    push(
      cashIn ? "debit" : "credit",
      isAR ? "expense" : "revenue",
      writeOff,
      accounts.writeOffAccountId,
      isAR ? "Bad Debt Expense" : "Vendor Write-Off Income",
      target
    );
    totalFxImpact += app.fxGainLossAmount;
  }
  if (currentDocumentReleased > totalAmount + EPSILON) {
    throw new Error("Applications exceed current document cash");
  }
  if (isDepositRefund) {
    assertBalanced(
      refundedPrincipal,
      totalAmount,
      EPSILON,
      "Deposit refund principal"
    );
    if (newOnAccountBase !== 0)
      throw new Error("Deposit refund cannot leave unapplied cash");
    totalFxImpact = cashIn
      ? round(grossBase - refundedCarrying)
      : round(refundedCarrying - grossBase);
  } else {
    assertBalanced(
      grossBase,
      round(currentCashReleased + newOnAccountBase),
      EPSILON,
      "Current payment funding"
    );
  }
  // Refunds release original advances above and cannot create new credit.
  if (!isDepositRefund && isDeposit) {
    push(
      cashIn ? "credit" : "debit",
      depositType,
      newOnAccountBase,
      depositAccountId ?? null,
      depositDescription(isAR)
    );
  } else if (!isDepositRefund) {
    push(
      cashIn ? "credit" : "debit",
      isAR ? "asset" : "liability",
      newOnAccountBase,
      accounts.controlAccountId,
      onAccountCreditDescription(isAR)
    );
  }
  for (const [accountId, released] of priorCreditReleased) {
    push(
      cashIn ? "debit" : "credit",
      released.isDeposit ? depositType : isAR ? "asset" : "liability",
      released.amount,
      accountId,
      released.isDeposit
        ? depositAppliedDescription(isAR)
        : `${isAR ? "Accounts Receivable" : "Accounts Payable"} (credit applied)`
    );
  }
  totalFxImpact = round(totalFxImpact);
  if (totalFxImpact > 0) {
    push(
      "credit",
      "revenue",
      totalFxImpact,
      accounts.fxGainAccountId,
      "Realized FX Gain"
    );
  } else if (totalFxImpact < 0) {
    push(
      "debit",
      "expense",
      -totalFxImpact,
      accounts.fxLossAccountId,
      "Realized FX Loss"
    );
  }
  assertBalanced(
    signedDebitTotal,
    0,
    EPSILON,
    "Payment journal (base currency)"
  );
  return { lines, signedDebitTotal, totalFxImpact };
}
