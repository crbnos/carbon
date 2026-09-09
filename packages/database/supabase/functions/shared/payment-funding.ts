import {
  calculateSettlementFx,
  toBaseAmount,
  toDocumentAmount
} from "./accounting-currency.ts";
import { round } from "./precision.ts";

export type FundingSource = {
  paymentId: string;
  postingDate: string;
  exchangeRate: number;
  remainingDocument: number;
  /** Original carrying base less effective recorded funding releases. */
  remainingBase: number;
};

export type FundingRequest = {
  targetId: string;
  targetExchangeRate: number;
  remainingDocument: number;
  /** Original target carrying base less effective recorded base relief. */
  remainingBase: number;
  requestedDocumentPrincipal: number;
  discountAmount: number;
  writeOffAmount: number;
};

export type FundingApplication = {
  targetId: string;
  sourcePaymentId: string | null;
  sourceAmount: number;
  sourceExchangeRate: number;
  targetExchangeRate: number;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number;
};

function nonnegativeAmount(amount: number, label: string): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be nonnegative and finite`);
  }
  return amount;
}

function addUniqueId(ids: Set<string>, id: string, label: string): void {
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`${label} ID is required`);
  }
  if (ids.has(id)) throw new Error(`Duplicate ${label} ID: ${id}`);
  ids.add(id);
}

/**
 * Pure allocation after the caller validates company, party, side, currency and
 * authoritative snapshots. Source/target document principal is independent of
 * carrying base; final exhaustion releases each recorded carrying residual.
 */
export function allocatePaymentFunding(input: {
  currentPayment: FundingSource;
  priorSources: FundingSource[];
  requests: FundingRequest[];
  currencyDecimals: number;
  isAR: boolean;
}): {
  applications: FundingApplication[];
  newOnAccountDocument: number;
  sourceRemainders: Array<{
    paymentId: string;
    remainingDocument: number;
    remainingBase: number;
  }>;
} {
  const { currencyDecimals, isAR } = input;
  // This also validates the configured decimal count through the common boundary.
  toDocumentAmount(0, 1, currencyDecimals);
  const documentScale = 10 ** currencyDecimals;
  const documentUnits = (amount: number, label: string): number => {
    nonnegativeAmount(amount, label);
    const normalized = toDocumentAmount(amount, 1, currencyDecimals);
    // Admit only binary arithmetic noise, never a fraction of a document unit.
    const noise = Number.EPSILON * Math.max(1, amount) * 4;
    if (Math.abs(amount - normalized) > noise) {
      throw new Error(`${label} exceeds document currency precision`);
    }
    const units = round(normalized * documentScale, 0);
    if (!Number.isSafeInteger(units)) {
      throw new Error(`${label} exceeds safe document currency units`);
    }
    return units;
  };
  const fromDocumentUnits = (units: number): number =>
    toDocumentAmount(units / documentScale, 1, currencyDecimals);

  const sourceIds = new Set<string>();
  const sources = [input.currentPayment, ...[...input.priorSources].sort((a, b) => {
    if (a.postingDate !== b.postingDate) return a.postingDate < b.postingDate ? -1 : 1;
    return a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0;
  })].map((source) => {
    addUniqueId(sourceIds, source.paymentId, "funding source");
    toBaseAmount(0, source.exchangeRate);
    const remainingUnits = documentUnits(source.remainingDocument, "Source amount");
    const remainingBase = toBaseAmount(nonnegativeAmount(source.remainingBase, "Source carrying base"), 1);
    if (remainingUnits === 0 && remainingBase !== 0) {
      throw new Error(`Exhausted source retains carrying base: ${source.paymentId}`);
    }
    return {
      ...source,
      remainingUnits,
      remainingBase
    };
  });

  const targetIds = new Set<string>();
  const requests = input.requests.map((request) => {
    addUniqueId(targetIds, request.targetId, "target");
    toBaseAmount(0, request.targetExchangeRate);
    const remainingUnits = documentUnits(request.remainingDocument, "Remaining target document amount");
    const principalUnits = documentUnits(request.requestedDocumentPrincipal, "Requested document principal");
    const remainingBase = toBaseAmount(nonnegativeAmount(request.remainingBase, "Remaining target base"), 1);
    const discountAmount = toBaseAmount(nonnegativeAmount(request.discountAmount, "Target discount amount"), 1);
    const writeOffAmount = toBaseAmount(nonnegativeAmount(request.writeOffAmount, "Target write-off amount"), 1);
    const reliefBase = round(discountAmount + writeOffAmount);
    const reliefUnits = documentUnits(
      toDocumentAmount(reliefBase, request.targetExchangeRate, currencyDecimals),
      "Target discount/write-off document amount"
    );
    if (principalUnits + reliefUnits > remainingUnits || reliefBase > remainingBase) {
      throw new Error(`Application exceeds target balance: ${request.targetId}`);
    }
    const availablePrincipalBase = round(remainingBase - reliefBase);
    const closesTarget = principalUnits + reliefUnits === remainingUnits;
    if (closesTarget && principalUnits === 0 && availablePrincipalBase !== 0) {
      throw new Error(`Full target relief must release its remaining carrying base: ${request.targetId}`);
    }
    const principalBase = closesTarget
      ? availablePrincipalBase
      : Math.min(
        toBaseAmount(fromDocumentUnits(principalUnits), request.targetExchangeRate),
        availablePrincipalBase
      );
    return { ...request, discountAmount, writeOffAmount, principalUnits, principalBase };
  });

  const applications: FundingApplication[] = [];
  let sourceIndex = 0;
  for (const request of requests) {
    let remainingUnits = request.principalUnits;
    let remainingBase = request.principalBase;
    let hasApplication = false;
    if (remainingUnits === 0) {
      if (request.discountAmount > 0 || request.writeOffAmount > 0) {
        applications.push({
          targetId: request.targetId,
          sourcePaymentId: null,
          sourceAmount: 0,
          sourceExchangeRate: input.currentPayment.exchangeRate,
          targetExchangeRate: request.targetExchangeRate,
          appliedAmount: 0,
          discountAmount: request.discountAmount,
          writeOffAmount: request.writeOffAmount,
          fxGainLossAmount: 0
        });
      }
      continue;
    }

    while (remainingUnits > 0) {
      const source = sources[sourceIndex];
      if (!source) throw new Error(`Insufficient payment funding for target: ${request.targetId}`);
      if (source.remainingUnits === 0) {
        sourceIndex++;
        continue;
      }
      const units = Math.min(remainingUnits, source.remainingUnits);
      const sourceAmount = fromDocumentUnits(units);
      const appliedAmount = units === remainingUnits
        ? remainingBase
        : Math.min(toBaseAmount(sourceAmount, request.targetExchangeRate), remainingBase);
      const sourceBaseAmount = units === source.remainingUnits
        ? source.remainingBase
        : Math.min(toBaseAmount(sourceAmount, source.exchangeRate), source.remainingBase);
      applications.push({
        targetId: request.targetId,
        sourcePaymentId: source.paymentId === input.currentPayment.paymentId ? null : source.paymentId,
        sourceAmount,
        sourceExchangeRate: source.exchangeRate,
        targetExchangeRate: request.targetExchangeRate,
        appliedAmount,
        discountAmount: hasApplication ? 0 : request.discountAmount,
        writeOffAmount: hasApplication ? 0 : request.writeOffAmount,
        fxGainLossAmount: calculateSettlementFx({
          appliedAmount, sourceAmount, sourceExchangeRate: source.exchangeRate, sourceBaseAmount, isAR
        })
      });
      hasApplication = true;
      remainingUnits -= units;
      remainingBase = round(remainingBase - appliedAmount);
      source.remainingUnits -= units;
      source.remainingBase = round(source.remainingBase - sourceBaseAmount);
    }
  }
  const sourceRemainders = sources.map((source) => ({
    paymentId: source.paymentId,
    remainingDocument: fromDocumentUnits(source.remainingUnits),
    remainingBase: source.remainingBase
  }));
  return {
    applications,
    newOnAccountDocument: sourceRemainders[0]?.remainingDocument ?? 0,
    sourceRemainders
  };
}

export type SettlementEffectiveness = {
  paymentId: string | null;
  memoId: string | null;
  appliedViaPaymentId: string | null;
  paymentStatus: string | null;
  memoStatus: string | null;
  viaStatus: string | null;
};

/** Parent status determines whether a persisted settlement has taken effect. */
export function isEffectiveSettlement(row: SettlementEffectiveness): boolean {
  return row.paymentId
    ? row.paymentStatus === "Posted"
    : Boolean(row.memoId && row.memoStatus === "Posted" &&
      (!row.appliedViaPaymentId || row.viaStatus === "Posted"));
}

export type SettlementBalanceRow = {
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  sourceAmount: number | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
};

function sourcePrincipal(value: number | null): number {
  if (value === null) throw new Error("Settlement is missing its document principal");
  return nonnegativeAmount(Number(value), "Settlement document principal");
}

/** Accumulate first; each adjustment is rounded at its document boundary. */
export function reduceInvoiceSettlements(
  rows: readonly Pick<SettlementBalanceRow, "sourceAmount" | "appliedAmount" | "discountAmount" | "writeOffAmount">[],
  exchangeRate: number,
  decimals: number
): { document: number; base: number } {
  let document = 0;
  let base = 0;
  for (const row of rows) {
    const adjustments = nonnegativeAmount(Number(row.discountAmount), "Settlement discount") +
      nonnegativeAmount(Number(row.writeOffAmount), "Settlement write-off");
    document += sourcePrincipal(row.sourceAmount) + toDocumentAmount(adjustments, exchangeRate, decimals);
    base += nonnegativeAmount(Number(row.appliedAmount), "Settlement applied amount") + adjustments;
  }
  return { document: toDocumentAmount(document, 1, decimals), base: round(base) };
}

/** Original controls use signed natural balances for both AR and AP. */
export function invoiceRemainingAmounts(
  invoice: { id: string | null; totalAmount: number | null; exchangeRate: number | null },
  rows: readonly SettlementBalanceRow[],
  controlAmounts: ReadonlyMap<string, number>,
  decimals: number,
  isAR: boolean
): { remainingDocument: number; remainingBase: number } {
  if (!invoice.id || invoice.totalAmount == null || invoice.exchangeRate == null) {
    throw new Error("Invoice identity, total or exchange rate is missing");
  }
  const rate = Number(invoice.exchangeRate);
  const consumed = reduceInvoiceSettlements(rows.filter((row) =>
    (isAR ? row.targetSalesInvoiceId : row.targetPurchaseInvoiceId) === invoice.id
  ), rate, decimals);
  const originalDocument = toDocumentAmount(Number(invoice.totalAmount), rate, decimals);
  const remainingDocument = toDocumentAmount(originalDocument - consumed.document, 1, decimals);
  const originalBase = controlAmounts.get(invoice.id) ?? round(Number(invoice.totalAmount));
  const remainingBase = round(originalBase - consumed.base);
  if (!Number.isFinite(remainingBase) || remainingDocument < 0 || remainingBase < 0) {
    throw new Error("Invoice already has excessive settlements or an invalid carrying balance");
  }
  return { remainingDocument, remainingBase };
}

export type FundingPaymentRow = {
  id: string;
  totalAmount: number;
  exchangeRate: number;
  postingDate: string | null;
  paymentDate: string;
  currencyCode: string;
};
export type FundingConsumptionRow = {
  paymentId: string | null;
  sourcePaymentId: string | null;
  sourceAmount: number | null;
  appliedAmount: number;
  fxGainLossAmount: number | null;
};

/** Callers select effective payments or reserved memos before reducing money. */
export function remainingFundingSources(
  payments: readonly FundingPaymentRow[],
  consumption: readonly FundingConsumptionRow[],
  decimals: ReadonlyMap<string, number>,
  isAR: boolean
): FundingSource[] {
  const consumed = new Map<string, { document: number; base: number }>();
  for (const row of consumption) {
    const sourceId = row.sourcePaymentId ?? row.paymentId;
    if (!sourceId) continue;
    const current = consumed.get(sourceId) ?? { document: 0, base: 0 };
    current.document += sourcePrincipal(row.sourceAmount);
    const fx = Number(row.fxGainLossAmount ?? 0);
    if (!Number.isFinite(fx)) throw new Error("Settlement FX must be finite");
    current.base += nonnegativeAmount(Number(row.appliedAmount), "Settlement applied amount") + (isAR ? 1 : -1) * fx;
    consumed.set(sourceId, current);
  }
  return payments.map((payment) => {
    const precision = decimals.get(payment.currencyCode);
    if (precision == null) throw new Error(`Currency ${payment.currencyCode} requires configured decimal places`);
    const use = consumed.get(payment.id);
    const total = nonnegativeAmount(Number(payment.totalAmount), "Funding document total");
    const remainingDocument = toDocumentAmount(total - (use?.document ?? 0), 1, precision);
    const remainingBase = round(toBaseAmount(total, Number(payment.exchangeRate)) - (use?.base ?? 0));
    if (remainingDocument < 0 || remainingBase < 0 || (remainingDocument === 0 && remainingBase !== 0)) {
      throw new Error(`Invalid remaining funding balance for payment ${payment.id}`);
    }
    return {
      paymentId: payment.id,
      postingDate: payment.postingDate ?? payment.paymentDate,
      exchangeRate: Number(payment.exchangeRate),
      remainingDocument,
      remainingBase
    };
  }).filter((payment) => payment.remainingDocument > 0);
}
