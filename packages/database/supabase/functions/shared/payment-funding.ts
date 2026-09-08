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
