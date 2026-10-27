// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure logic behind the payment form and the settlement composers (apply to
// invoices, apply credits, applications history).

import {
  allocatePaymentFunding,
  type FundingRequest,
  type FundingScope,
  type FundingSource,
  fundableDocumentAmounts,
  fundingScopeCovers,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import type { getInvoiceSettlements } from "~/modules/invoicing/invoicing.service";

// ---------------------------------------------------------------------------
// Payment form
// ---------------------------------------------------------------------------

const PARTY_FIELDS = ["customerId", "supplierId", "employeeId"] as const;
type PartyField = (typeof PARTY_FIELDS)[number];

/**
 * Cash direction and subledger party are independent for refunds. An employee
 * payee is neither: it is always cash OUT against the reimbursement control
 * account, so it has a single kind rather than a payment/refund pair.
 */
export function initialPaymentKind(values: {
  employeeId?: string | null;
  supplierId?: string | null;
  paymentType?: string | null;
}): string {
  return values.employeeId
    ? "employee-payment"
    : values.supplierId
      ? values.paymentType === "Receipt"
        ? "supplier-refund"
        : "supplier-payment"
      : values.paymentType === "Disbursement"
        ? "customer-refund"
        : "customer-payment";
}

/**
 * What a payment kind submits: its cash direction, the one party field it
 * mounts, and the two it blanks (the validator and `payment_party_check`
 * refuse anything but exactly one party).
 */
export function paymentKindFields(kind: string): {
  paymentType: "Receipt" | "Disbursement";
  party: PartyField;
  blank: PartyField[];
} {
  const party: PartyField =
    kind === "employee-payment"
      ? "employeeId"
      : kind.startsWith("customer-")
        ? "customerId"
        : "supplierId";
  return {
    paymentType:
      kind === "customer-payment" || kind === "supplier-refund"
        ? "Receipt"
        : "Disbursement",
    party,
    blank: PARTY_FIELDS.filter((field) => field !== party)
  };
}

/** The total is entered in the payment's own currency, not the company's. */
export function paymentDocumentCurrency(
  currencyCode: string | null | undefined,
  baseCurrencyCode: string | null | undefined
): string {
  return currencyCode || baseCurrencyCode || "USD";
}

// ---------------------------------------------------------------------------
// Apply to invoices / memos / reimbursements
// ---------------------------------------------------------------------------

// An open invoice for the payment's counterparty.
export type OpenInvoice = {
  id: string;
  invoiceId: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  balance: number;
  remainingDocument: number;
  status: string | null;
  // The documents the invoice bills: a customer deposit funds only invoices of
  // its own rental agreement or sales order.
  rentalAgreementIds?: string[];
  salesOrderIds?: string[];
};

export type ExistingApplication = {
  targetMemoId?: string | null;
  targetReimbursementId?: string | null;
  sourceAmount: number | null;
  sourcePaymentId?: string | null;
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  targetExchangeRate: number;
  sourceExchangeRate: number;
  appliedDate: string;
};

// The invoice's read-only fields plus the editable selection state.
export type ApplyRow = {
  sourceAmount: number;
  id: string;
  invoiceId: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  balance: number;
  remainingDocument: number;
  rentalAgreementIds?: string[];
  salesOrderIds?: string[];
  checked: boolean;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
};

export type AmountField = "appliedAmount" | "discountAmount" | "writeOffAmount";

// Which kind of document the payment settles.
export type ApplyTargets = {
  isReceipt: boolean;
  isRefund: boolean;
  isReimbursement: boolean;
};

export type ApplyFunding = {
  currentPayment: FundingSource;
  priorSources: FundingSource[];
  currencyDecimals: number;
};

/**
 * The rows the composer opens with: open documents in the payment's currency,
 * with what a saved draft already applies to each (its funding splits summed).
 */
export function seedApplyRows({
  openInvoices,
  existingApplications,
  targets: { isReceipt, isRefund, isReimbursement },
  paymentCurrency,
  paymentScope,
  currencyDecimals
}: {
  openInvoices: OpenInvoice[];
  existingApplications: ExistingApplication[];
  targets: ApplyTargets;
  paymentCurrency: string;
  paymentScope: FundingScope | null;
  currencyDecimals: number;
}): ApplyRow[] {
  const byInvoice = new Map<
    string,
    {
      appliedAmount: number;
      discountAmount: number;
      writeOffAmount: number;
      sourceAmount: number;
    }
  >();
  for (const a of existingApplications) {
    const id = isReimbursement
      ? a.targetReimbursementId
      : isRefund
        ? a.targetMemoId
        : isReceipt
          ? a.targetSalesInvoiceId
          : a.targetPurchaseInvoiceId;
    if (!id) continue;
    const existing = byInvoice.get(id) ?? {
      appliedAmount: 0,
      discountAmount: 0,
      writeOffAmount: 0,
      sourceAmount: 0
    };
    existing.appliedAmount = round(existing.appliedAmount + a.appliedAmount);
    existing.discountAmount = round(existing.discountAmount + a.discountAmount);
    existing.writeOffAmount = round(existing.writeOffAmount + a.writeOffAmount);
    existing.sourceAmount = toDocumentAmount(
      existing.sourceAmount +
        (a.sourceAmount ??
          toDocumentAmount(
            a.appliedAmount,
            a.targetExchangeRate,
            currencyDecimals
          )),
      1,
      currencyDecimals
    );
    byInvoice.set(id, existing);
  }
  return openInvoices
    .filter(
      (inv) =>
        inv.currencyCode === paymentCurrency &&
        inv.remainingDocument > 0 &&
        // A deposit lists only its own document's invoices (and any it is
        // already applied to, so the allocator's refusal can say why).
        (fundingScopeCovers(paymentScope, inv) || byInvoice.has(inv.id))
    )
    .map((inv) => ({
      ...inv,
      checked: byInvoice.has(inv.id),
      appliedAmount: 0,
      discountAmount: 0,
      writeOffAmount: 0,
      sourceAmount: 0,
      ...byInvoice.get(inv.id)
    }));
}

/** The selected rows as allocator requests. */
export function fundingRequests(rows: ApplyRow[]): FundingRequest[] {
  return rows
    .filter((r) => r.checked)
    .map((r) => ({
      targetId: r.id,
      targetExchangeRate: r.exchangeRate,
      remainingDocument: r.remainingDocument,
      remainingBase: r.balance,
      requestedDocumentPrincipal: r.sourceAmount,
      discountAmount: r.discountAmount,
      writeOffAmount: r.writeOffAmount,
      rentalAgreementIds: r.rentalAgreementIds,
      salesOrderIds: r.salesOrderIds
    }));
}

/**
 * Selecting a row fills it with what it can draw once every other selected
 * row keeps its amount (deposits reach only their own document's invoices).
 * A full draw relieves the whole base balance, so no carrying cent is left.
 */
export function toggleApplyRow(
  rows: ApplyRow[],
  id: string,
  checked: boolean,
  { currentPayment, priorSources, currencyDecimals }: ApplyFunding
): ApplyRow[] {
  const toggled = rows.find((r) => r.id === id);
  const available = toggled
    ? fundableDocumentAmounts({
        currentPayment,
        priorSources,
        currencyDecimals,
        requests: [
          ...rows
            .filter((r) => r.id !== id && r.checked)
            .map((r) => ({ ...r, maximumDocument: r.sourceAmount })),
          { ...toggled, maximumDocument: toggled.remainingDocument }
        ]
      }).at(-1)!
    : 0;
  return rows.map((r) => {
    if (r.id !== id) return r;
    if (!checked)
      return {
        ...r,
        checked: false,
        sourceAmount: 0,
        appliedAmount: 0,
        discountAmount: 0,
        writeOffAmount: 0
      };
    const sourceAmount = Math.min(available, r.remainingDocument);
    return {
      ...r,
      checked: true,
      sourceAmount,
      appliedAmount:
        sourceAmount === r.remainingDocument
          ? r.balance
          : Math.min(r.balance, toBaseAmount(sourceAmount, r.exchangeRate)),
      discountAmount: 0,
      writeOffAmount: 0
    };
  });
}

/**
 * An edited base amount. Applied converts to document cash at the row's rate;
 * a discount or write-off on a row that relieves the whole document moves
 * cash out of the row so the row still relieves it exactly.
 */
export function updateApplyAmount(
  rows: ApplyRow[],
  id: string,
  field: AmountField,
  value: number,
  currencyDecimals: number
): ApplyRow[] {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r, [field]: round(Math.max(0, value)) };
    if (field === "appliedAmount")
      next.sourceAmount = toDocumentAmount(
        next.appliedAmount,
        r.exchangeRate,
        currencyDecimals
      );
    else if (
      toDocumentAmount(
        r.sourceAmount +
          toDocumentAmount(
            r.discountAmount + r.writeOffAmount,
            r.exchangeRate,
            currencyDecimals
          ),
        1,
        currencyDecimals
      ) === r.remainingDocument
    ) {
      next.appliedAmount = Math.max(
        0,
        round(r.balance - next.discountAmount - next.writeOffAmount)
      );
      next.sourceAmount = Math.max(
        0,
        toDocumentAmount(
          r.remainingDocument -
            toDocumentAmount(
              next.discountAmount + next.writeOffAmount,
              r.exchangeRate,
              currencyDecimals
            ),
          1,
          currencyDecimals
        )
      );
    }
    next.checked =
      next.sourceAmount + next.discountAmount + next.writeOffAmount > 0;
    return next;
  });
}

/** Fill rows in order, each with as much as the funding it may use allows. */
export function autoApplyRows(
  rows: ApplyRow[],
  {
    currentPayment,
    priorSources,
    currencyDecimals,
    isReceipt
  }: ApplyFunding & { isReceipt: boolean }
): ApplyRow[] {
  const amounts = fundableDocumentAmounts({
    currentPayment,
    priorSources,
    currencyDecimals,
    requests: rows.map((r) => ({ ...r, maximumDocument: r.remainingDocument }))
  });
  const requests = rows.map((r, i) => ({
    targetId: r.id,
    targetExchangeRate: r.exchangeRate,
    remainingDocument: r.remainingDocument,
    remainingBase: r.balance,
    requestedDocumentPrincipal: amounts[i]!,
    discountAmount: 0,
    writeOffAmount: 0,
    rentalAgreementIds: r.rentalAgreementIds,
    salesOrderIds: r.salesOrderIds
  }));
  const result = allocatePaymentFunding({
    currentPayment,
    priorSources,
    requests,
    currencyDecimals,
    isAR: isReceipt
  });
  return rows.map((r) => {
    const apps = result.applications.filter((a) => a.targetId === r.id);
    return {
      ...r,
      checked: apps.length > 0,
      sourceAmount: toDocumentAmount(
        apps.reduce((sum, a) => sum + a.sourceAmount, 0),
        1,
        currencyDecimals
      ),
      appliedAmount: round(apps.reduce((sum, a) => sum + a.appliedAmount, 0)),
      discountAmount: 0,
      writeOffAmount: 0
    };
  });
}

/**
 * What Save applications posts. Each row targets exactly one column: a trade
 * invoice by direction, a memo for a refund, a reimbursement for an employee.
 */
export function buildApplications(
  rows: ApplyRow[],
  {
    targets: { isReceipt, isRefund, isReimbursement },
    paymentExchangeRate,
    today
  }: { targets: ApplyTargets; paymentExchangeRate: number; today: string }
) {
  // Discount and write-off only exist on a trade invoice settlement.
  const hasAdjustments = !isRefund && !isReimbursement;
  return rows
    .filter(
      (r) =>
        r.checked && r.sourceAmount + r.discountAmount + r.writeOffAmount > 0
    )
    .map((r) => ({
      targetSalesInvoiceId: hasAdjustments && isReceipt ? r.id : undefined,
      targetPurchaseInvoiceId: hasAdjustments && !isReceipt ? r.id : undefined,
      targetMemoId: isRefund ? r.id : undefined,
      targetReimbursementId: isReimbursement ? r.id : undefined,
      appliedAmount: r.appliedAmount,
      sourceAmount: r.sourceAmount,
      discountAmount: r.discountAmount,
      writeOffAmount: r.writeOffAmount,
      targetExchangeRate: r.exchangeRate,
      sourceExchangeRate: paymentExchangeRate,
      appliedDate: today
    }));
}

// ---------------------------------------------------------------------------
// Apply available credits (memos)
// ---------------------------------------------------------------------------

// A posted, balance-reducing memo the party can apply to an open invoice.
export type AvailableCredit = {
  id: string;
  memoId: string;
  direction: string;
  currencyCode: string;
  exchangeRate: number;
  remaining: number;
  remainingDocument: number;
};

export type OpenInvoiceOption = {
  id: string;
  invoiceId: string;
  exchangeRate: number;
  balance: number;
  remainingDocument: number;
};

export type StagedCredit = {
  memoId: string;
  invoiceId: string;
  amount: number;
  sourceAmount?: number | null;
};

export type CreditRow = {
  id: string;
  memoId: string;
  direction: string;
  remaining: number;
  remainingDocument: number;
  checked: boolean;
  invoiceId: string; // target invoice id
  amount: number;
  sourceAmount: number;
  exchangeRate: number;
};

/** Credits pre-filled from what this Draft payment already stages. */
export function seedCreditRows(
  credits: AvailableCredit[],
  openInvoices: OpenInvoiceOption[],
  staged: StagedCredit[],
  documentDecimals: number
): CreditRow[] {
  // staged is keyed by the memo's row id (== credit.id).
  const stagedByMemo = new Map(staged.map((s) => [s.memoId, s]));
  return credits.map((c) => {
    const s = stagedByMemo.get(c.id);
    return {
      id: c.id,
      memoId: c.memoId,
      direction: c.direction,
      remaining: c.remaining,
      remainingDocument: c.remainingDocument,
      exchangeRate: c.exchangeRate,
      checked: Boolean(s),
      invoiceId:
        s?.invoiceId ??
        openInvoices.find((i) => i.exchangeRate === c.exchangeRate)?.id ??
        "",
      amount: s?.amount ?? 0,
      sourceAmount:
        s?.sourceAmount ??
        (s ? toDocumentAmount(s.amount, c.exchangeRate, documentDecimals) : 0)
    };
  });
}

/**
 * The most a credit can apply to an invoice at the same rate. When either
 * side is used up in full, its own base amount is taken so no cent of
 * carrying base is left behind.
 */
export function creditCap(
  row: CreditRow,
  invoice: OpenInvoiceOption | undefined
): { amount: number; sourceAmount: number } {
  if (!invoice || invoice.exchangeRate !== row.exchangeRate)
    return { amount: 0, sourceAmount: 0 };
  const sourceAmount = Math.min(
    row.remainingDocument,
    invoice.remainingDocument
  );
  const amount =
    sourceAmount === invoice.remainingDocument
      ? invoice.balance
      : sourceAmount === row.remainingDocument
        ? row.remaining
        : toBaseAmount(sourceAmount, row.exchangeRate);
  return { amount, sourceAmount };
}

export function toggleCreditRow(
  rows: CreditRow[],
  id: string,
  checked: boolean,
  invoicesById: ReadonlyMap<string, OpenInvoiceOption>
): CreditRow[] {
  return rows.map((r) =>
    r.id !== id
      ? r
      : {
          ...r,
          checked,
          ...(checked
            ? creditCap(r, invoicesById.get(r.invoiceId))
            : { amount: 0, sourceAmount: 0 })
        }
  );
}

export function changeCreditInvoice(
  rows: CreditRow[],
  id: string,
  invoiceId: string,
  invoicesById: ReadonlyMap<string, OpenInvoiceOption>
): CreditRow[] {
  return rows.map((r) =>
    r.id !== id
      ? r
      : {
          ...r,
          invoiceId,
          ...(r.checked ? creditCap(r, invoicesById.get(invoiceId)) : {})
        }
  );
}

export function updateCreditAmount(
  rows: CreditRow[],
  id: string,
  value: number,
  documentDecimals: number
): CreditRow[] {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const amount = round(Math.max(0, value));
    const sourceAmount = toDocumentAmount(
      amount,
      r.exchangeRate,
      documentDecimals
    );
    return { ...r, amount, sourceAmount, checked: sourceAmount > 0 };
  });
}

export function buildCreditApplications(rows: CreditRow[]) {
  return rows
    .filter((r) => r.checked && r.sourceAmount > 0 && r.invoiceId)
    .map((r) => ({
      memoId: r.id,
      invoiceId: r.invoiceId,
      amount: r.amount,
      sourceAmount: r.sourceAmount
    }));
}

// ---------------------------------------------------------------------------
// Applications history
// ---------------------------------------------------------------------------

export type PaymentApplication = NonNullable<
  Awaited<ReturnType<typeof getInvoiceSettlements>>["data"]
>[number];

/** One row per target document: its funding splits summed. */
export function aggregateApplications(splits: PaymentApplication[]) {
  const byInvoice = new Map<
    string,
    PaymentApplication & { sourceRates: number[] }
  >();
  for (const a of splits) {
    const id =
      a.targetSalesInvoiceId ??
      a.targetPurchaseInvoiceId ??
      a.targetMemoId ??
      a.targetReimbursementId ??
      a.id;
    const existing = byInvoice.get(id);
    if (!existing) {
      byInvoice.set(id, { ...a, sourceRates: [Number(a.sourceExchangeRate)] });
      continue;
    }
    existing.appliedAmount = round(
      existing.appliedAmount + Number(a.appliedAmount)
    );
    existing.discountAmount = round(
      existing.discountAmount + Number(a.discountAmount)
    );
    existing.writeOffAmount = round(
      existing.writeOffAmount + Number(a.writeOffAmount)
    );
    existing.sourceAmount =
      (existing.sourceAmount ?? 0) + Number(a.sourceAmount ?? 0);
    existing.fxGainLossAmount = round(
      Number(existing.fxGainLossAmount ?? 0) + Number(a.fxGainLossAmount ?? 0)
    );
    existing.sourceRates = [
      ...new Set([...existing.sourceRates, Number(a.sourceExchangeRate)])
    ];
  }
  return [...byInvoice.values()];
}

/** This payment's own cash not yet applied; prior payments' splits draw none of it. */
export function unappliedPaymentCash(
  paymentTotal: number,
  splits: PaymentApplication[]
): number {
  return (
    paymentTotal -
    splits.reduce(
      (s, a) => s + (a.sourcePaymentId ? 0 : Number(a.sourceAmount ?? 0)),
      0
    )
  );
}
