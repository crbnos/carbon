// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assertCurrencyDecimals,
  assertExchangeRate,
  calculateSettlementFx,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/database/accounting-currency";
import { round } from "@carbon/database/precision";

/**
 * The document a customer deposit secures (`payment.rentalAgreementId` /
 * `payment.salesOrderId`). A deposit funds only invoices that bill that
 * document — a `salesInvoiceLine` carrying the same id — never the customer's
 * other invoices. An unscoped source funds anything.
 */
export type FundingScope = {
  type: "rentalAgreement" | "salesOrder";
  /** The document's row id, as stored on the payment and the invoice line. */
  id: string;
  /** Readable id (RA000001, SO000123) for messages; optional. */
  readableId?: string | null;
};

export type FundingSource = {
  paymentId: string;
  postingDate: string;
  exchangeRate: number;
  remainingDocument: number;
  /** Original carrying base less effective recorded funding releases. */
  remainingBase: number;
  /** Set when the source is a customer deposit; absent or null funds anything. */
  scope?: FundingScope | null;
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
  /** Rental agreements the target invoice bills (`salesInvoiceLine.rentalAgreementId`). */
  rentalAgreementIds?: readonly string[];
  /** Sales orders the target invoice bills (`salesInvoiceLine.salesOrderId`). */
  salesOrderIds?: readonly string[];
};

/** The deposit scope a payment row carries, or null for an ordinary payment. */
export function fundingScopeOf(row: {
  rentalAgreementId?: string | null;
  salesOrderId?: string | null;
}): FundingScope | null {
  if (row.rentalAgreementId)
    return { type: "rentalAgreement", id: row.rentalAgreementId };
  if (row.salesOrderId) return { type: "salesOrder", id: row.salesOrderId };
  return null;
}

/** Whether a source with this scope may fund the request's target. */
export function fundingScopeCovers(
  scope: FundingScope | null | undefined,
  request: Pick<FundingRequest, "rentalAgreementIds" | "salesOrderIds">
): boolean {
  if (!scope) return true;
  const ids =
    scope.type === "rentalAgreement"
      ? request.rentalAgreementIds
      : request.salesOrderIds;
  return Boolean(ids?.includes(scope.id));
}

/** The refusal for applying a deposit to an invoice of another document. */
export function depositScopeMessage(scope: FundingScope): string {
  const owner =
    scope.type === "rentalAgreement" ? "that agreement's" : "that order's";
  if (scope.readableId)
    return `A deposit for ${scope.readableId} can only be applied to ${owner} invoices`;
  return scope.type === "rentalAgreement"
    ? "A rental agreement deposit can only be applied to that agreement's invoices"
    : "A sales order deposit can only be applied to that order's invoices";
}

function assertScope(scope: FundingScope | null | undefined): void {
  if (!scope) return;
  if (
    (scope.type !== "rentalAgreement" && scope.type !== "salesOrder") ||
    typeof scope.id !== "string" ||
    !scope.id.trim()
  ) {
    throw new Error("Funding source scope requires a document type and ID");
  }
}

/** Allocation order: the current payment, then prior sources oldest first. */
function orderFundingSources<T extends FundingSource>(
  currentPayment: T,
  priorSources: readonly T[]
): T[] {
  return [
    currentPayment,
    ...[...priorSources].sort((a, b) => {
      if (a.postingDate !== b.postingDate)
        return a.postingDate < b.postingDate ? -1 : 1;
      return a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0;
    })
  ];
}

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
 * Integer transport from origins to targets over an eligibility graph, filling
 * the origins in list order: each origin sends as much as it can, through
 * augmenting paths that may re-route an earlier origin's units to another
 * eligible target but never reduce its total. The result is the
 * lexicographically largest use of the origins in order (so the current
 * payment is spent before any prior source, and prior sources oldest first),
 * and it reaches every target any assignment could. With every edge eligible
 * it is the plain staircase: origin by origin, targets in list order.
 */
function prioritizedTransport(
  originUnits: readonly number[],
  targetUnits: readonly number[],
  eligible: (origin: number, target: number) => boolean
): number[][] {
  const flow = originUnits.map(() => targetUnits.map(() => 0));
  const edges = originUnits.map((_, o) =>
    targetUnits.map((_, t) => eligible(o, t))
  );
  const spare = [...originUnits];
  const open = [...targetUnits];
  for (const [root] of originUnits.entries()) {
    while (spare[root]! > 0) {
      // Breadth-first: origin → eligible target; a full target hands one of
      // its funding origins on to look for another target.
      const reachedTargetFrom = targetUnits.map(() => -1);
      const reachedOriginFrom = originUnits.map(() => -1);
      const queue = [root];
      let end = -1;
      for (let head = 0; head < queue.length && end < 0; head++) {
        const origin = queue[head]!;
        for (const [target] of targetUnits.entries()) {
          if (!edges[origin]![target] || reachedTargetFrom[target] !== -1)
            continue;
          reachedTargetFrom[target] = origin;
          if (open[target]! > 0) {
            end = target;
            break;
          }
          for (const [other] of originUnits.entries()) {
            if (
              other !== root &&
              reachedOriginFrom[other] === -1 &&
              flow[other]![target]! > 0
            ) {
              reachedOriginFrom[other] = target;
              queue.push(other);
            }
          }
        }
      }
      if (end < 0) break;
      let amount = Math.min(spare[root]!, open[end]!);
      for (let target = end; ; ) {
        const origin = reachedTargetFrom[target]!;
        if (origin === root) break;
        target = reachedOriginFrom[origin]!;
        amount = Math.min(amount, flow[origin]![target]!);
      }
      for (let target = end; ; ) {
        const origin = reachedTargetFrom[target]!;
        flow[origin]![target]! += amount;
        if (origin === root) break;
        target = reachedOriginFrom[origin]!;
        flow[origin]![target]! -= amount;
      }
      spare[root]! -= amount;
      open[end]! -= amount;
    }
  }
  return flow;
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
  assertCurrencyDecimals(currencyDecimals);
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
  const sources = orderFundingSources(
    input.currentPayment,
    input.priorSources
  ).map((source) => {
    addUniqueId(sourceIds, source.paymentId, "funding source");
    assertExchangeRate(source.exchangeRate);
    assertScope(source.scope);
    const remainingUnits = documentUnits(
      source.remainingDocument,
      "Source amount"
    );
    const remainingBase = toBaseAmount(
      nonnegativeAmount(source.remainingBase, "Source carrying base"),
      1
    );
    if (remainingUnits === 0 && remainingBase !== 0) {
      throw new Error(
        `Exhausted source retains carrying base: ${source.paymentId}`
      );
    }
    return {
      ...source,
      remainingUnits,
      remainingBase
    };
  });

  const targetIds = new Set<string>();
  const currentScope = input.currentPayment.scope;
  const requests = input.requests.map((request) => {
    addUniqueId(targetIds, request.targetId, "target");
    // A deposit is applied only to its own document's invoices, whatever
    // would fund the application — refused, not silently re-sourced.
    if (currentScope && !fundingScopeCovers(currentScope, request))
      throw new Error(depositScopeMessage(currentScope));
    assertExchangeRate(request.targetExchangeRate);
    const remainingUnits = documentUnits(
      request.remainingDocument,
      "Remaining target document amount"
    );
    const principalUnits = documentUnits(
      request.requestedDocumentPrincipal,
      "Requested document principal"
    );
    const remainingBase = toBaseAmount(
      nonnegativeAmount(request.remainingBase, "Remaining target base"),
      1
    );
    const discountAmount = toBaseAmount(
      nonnegativeAmount(request.discountAmount, "Target discount amount"),
      1
    );
    const writeOffAmount = toBaseAmount(
      nonnegativeAmount(request.writeOffAmount, "Target write-off amount"),
      1
    );
    const reliefBase = round(discountAmount + writeOffAmount);
    const reliefUnits = documentUnits(
      toDocumentAmount(
        reliefBase,
        request.targetExchangeRate,
        currencyDecimals
      ),
      "Target discount/write-off document amount"
    );
    if (
      principalUnits + reliefUnits > remainingUnits ||
      reliefBase > remainingBase
    ) {
      throw new Error(
        `Application exceeds target balance: ${request.targetId}`
      );
    }
    const availablePrincipalBase = round(remainingBase - reliefBase);
    const closesTarget = principalUnits + reliefUnits === remainingUnits;
    if (closesTarget && principalUnits === 0 && availablePrincipalBase !== 0) {
      throw new Error(
        `Full target relief must release its remaining carrying base: ${request.targetId}`
      );
    }
    const principalBase = closesTarget
      ? availablePrincipalBase
      : Math.min(
          toBaseAmount(
            fromDocumentUnits(principalUnits),
            request.targetExchangeRate
          ),
          availablePrincipalBase
        );
    return {
      ...request,
      discountAmount,
      writeOffAmount,
      principalUnits,
      principalBase
    };
  });

  // Which source funds how much of which request, decided over all requests
  // at once: a deposit can fund only its own document's invoices, so a
  // request-by-request walk could spend ordinary cash on a deposit's invoice
  // and then refuse another invoice the deposit cannot reach — and whether it
  // did would depend on the order the caller listed the requests in.
  const flow = prioritizedTransport(
    sources.map((source) => source.remainingUnits),
    requests.map((request) => request.principalUnits),
    (s, r) => fundingScopeCovers(sources[s]!.scope, requests[r]!)
  );
  requests.forEach((request, r) => {
    const funded = flow.reduce((sum, row) => sum + row[r]!, 0);
    if (funded < request.principalUnits)
      throw new Error(
        `Insufficient payment funding for target: ${request.targetId}`
      );
  });

  const applications: FundingApplication[] = [];
  for (const [r, request] of requests.entries()) {
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

    // Applications follow source order within the request, so the arithmetic
    // per (source, target) pair is the same as a plain walk's.
    for (const [s, source] of sources.entries()) {
      const units = flow[s]![r]!;
      if (units === 0) continue;
      const sourceAmount = fromDocumentUnits(units);
      const appliedAmount =
        units === remainingUnits
          ? remainingBase
          : Math.min(
              toBaseAmount(sourceAmount, request.targetExchangeRate),
              remainingBase
            );
      const sourceBaseAmount =
        units === source.remainingUnits
          ? source.remainingBase
          : Math.min(
              toBaseAmount(sourceAmount, source.exchangeRate),
              source.remainingBase
            );
      applications.push({
        targetId: request.targetId,
        sourcePaymentId:
          source.paymentId === input.currentPayment.paymentId
            ? null
            : source.paymentId,
        sourceAmount,
        sourceExchangeRate: source.exchangeRate,
        targetExchangeRate: request.targetExchangeRate,
        appliedAmount,
        discountAmount: hasApplication ? 0 : request.discountAmount,
        writeOffAmount: hasApplication ? 0 : request.writeOffAmount,
        fxGainLossAmount: calculateSettlementFx({
          appliedAmount,
          sourceAmount,
          sourceExchangeRate: source.exchangeRate,
          sourceBaseAmount,
          isAR
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

/**
 * How much document principal each request could draw, earlier requests first,
 * under the allocator's eligibility: a deposit only reaches invoices of its own
 * document, and a deposit payment reaches nothing else. Feeding the results
 * back as `requestedDocumentPrincipal` always allocates. `maximumDocument` caps
 * a request (the invoice's open document amount, or an amount already entered);
 * list the rows to keep first and the row to fill last to ask how much that row
 * can add.
 */
export function fundableDocumentAmounts(input: {
  currentPayment: FundingSource;
  priorSources: readonly FundingSource[];
  requests: ReadonlyArray<
    Pick<FundingRequest, "rentalAgreementIds" | "salesOrderIds"> & {
      maximumDocument: number;
    }
  >;
  currencyDecimals: number;
}): number[] {
  const { currencyDecimals } = input;
  assertCurrencyDecimals(currencyDecimals);
  const scale = 10 ** currencyDecimals;
  const toUnits = (amount: number): number =>
    Math.max(
      0,
      round(toDocumentAmount(amount, 1, currencyDecimals) * scale, 0)
    );
  const sources = orderFundingSources(input.currentPayment, input.priorSources);
  const currentScope = input.currentPayment.scope;
  // Requests are the origins here, so earlier requests are filled first.
  const flow = prioritizedTransport(
    input.requests.map((request) =>
      currentScope && !fundingScopeCovers(currentScope, request)
        ? 0
        : toUnits(request.maximumDocument)
    ),
    sources.map((source) => toUnits(source.remainingDocument)),
    (r, s) => fundingScopeCovers(sources[s]!.scope, input.requests[r]!)
  );
  return flow.map((row) =>
    toDocumentAmount(
      row.reduce((sum, units) => sum + units, 0) / scale,
      1,
      currencyDecimals
    )
  );
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
    : Boolean(
        row.memoId &&
          row.memoStatus === "Posted" &&
          (!row.appliedViaPaymentId || row.viaStatus === "Posted")
      );
}

export type SettlementBalanceRow = {
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  /** An employee reimbursement settled by a disbursement to that employee.
   *  Nullable on every AR/AP row, so callers that never see one may pass
   *  `null` (or omit the column and spread it in). */
  targetReimbursementId?: string | null;
  sourceAmount: number | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
};

function sourcePrincipal(value: number | null): number {
  if (value === null)
    throw new Error("Settlement is missing its document principal");
  return nonnegativeAmount(Number(value), "Settlement document principal");
}

function settlementPrincipal(
  row: { sourceAmount: number | null; appliedAmount: number },
  exchangeRate: number,
  decimals: number
): number {
  if (row.sourceAmount !== null) return sourcePrincipal(row.sourceAmount);
  return toDocumentAmount(
    nonnegativeAmount(Number(row.appliedAmount), "Settlement applied amount"),
    exchangeRate,
    decimals
  );
}

/** Accumulate first; each adjustment is rounded at its document boundary. */
export function reduceInvoiceSettlements(
  rows: readonly Pick<
    SettlementBalanceRow,
    "sourceAmount" | "appliedAmount" | "discountAmount" | "writeOffAmount"
  >[],
  exchangeRate: number,
  decimals: number
): { document: number; base: number } {
  let document = 0;
  let base = 0;
  for (const row of rows) {
    const adjustments =
      nonnegativeAmount(Number(row.discountAmount), "Settlement discount") +
      nonnegativeAmount(Number(row.writeOffAmount), "Settlement write-off");
    document +=
      settlementPrincipal(row, exchangeRate, decimals) +
      toDocumentAmount(adjustments, exchangeRate, decimals);
    base +=
      nonnegativeAmount(
        Number(row.appliedAmount),
        "Settlement applied amount"
      ) + adjustments;
  }
  return {
    document: toDocumentAmount(document, 1, decimals),
    base: round(base)
  };
}

/** Original controls use signed natural balances for both AR and AP.
 *
 *  `isReimbursement` selects the third target column. An employee
 *  reimbursement is a TARGET exactly like a payable invoice — a liability with
 *  a carrying value that prior settlements draw down — so it nets the same way;
 *  only the column its settlements are keyed on differs. It is a separate flag
 *  rather than a third `isAR` state because `isAR` still answers a different
 *  question here (which side of the ledger), and a reimbursement is always the
 *  payable side. */
export function invoiceRemainingAmounts(
  invoice: {
    id: string | null;
    totalAmount: number | null;
    exchangeRate: number | null;
  },
  rows: readonly SettlementBalanceRow[],
  controlAmounts: ReadonlyMap<string, number>,
  decimals: number,
  isAR: boolean,
  isReimbursement = false
): { remainingDocument: number; remainingBase: number } {
  if (
    !invoice.id ||
    invoice.totalAmount == null ||
    invoice.exchangeRate == null
  ) {
    throw new Error("Invoice identity, total or exchange rate is missing");
  }
  const rate = Number(invoice.exchangeRate);
  const targetOf = (row: SettlementBalanceRow): string | null | undefined =>
    isReimbursement
      ? row.targetReimbursementId
      : isAR
        ? row.targetSalesInvoiceId
        : row.targetPurchaseInvoiceId;
  const consumed = reduceInvoiceSettlements(
    rows.filter((row) => targetOf(row) === invoice.id),
    rate,
    decimals
  );
  const originalDocument = toDocumentAmount(
    Number(invoice.totalAmount),
    rate,
    decimals
  );
  const remainingDocument = toDocumentAmount(
    originalDocument - consumed.document,
    1,
    decimals
  );
  const originalBase =
    controlAmounts.get(invoice.id) ?? round(Number(invoice.totalAmount));
  const remainingBase = round(originalBase - consumed.base);
  if (
    !Number.isFinite(remainingBase) ||
    remainingDocument < 0 ||
    remainingBase < 0
  ) {
    throw new Error(
      "Invoice already has excessive settlements or an invalid carrying balance"
    );
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
  /** A deposit's document (`fundingScopeOf`), carried onto the source. */
  scope?: FundingScope | null;
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
  const precisionFor = (payment: FundingPaymentRow): number => {
    const precision = decimals.get(payment.currencyCode);
    if (precision == null)
      throw new Error(
        `Currency ${payment.currencyCode} requires configured decimal places`
      );
    return precision;
  };
  const paymentsById = new Map(
    payments.map((payment) => [payment.id, payment])
  );
  const consumed = new Map<string, { document: number; base: number }>();
  for (const row of consumption) {
    const sourceId = row.sourcePaymentId ?? row.paymentId;
    if (!sourceId) continue;
    const current = consumed.get(sourceId) ?? { document: 0, base: 0 };
    if (row.sourceAmount === null && row.sourcePaymentId === null) {
      const payment = paymentsById.get(sourceId);
      if (!payment) continue;
      current.document += settlementPrincipal(
        row,
        Number(payment.exchangeRate),
        precisionFor(payment)
      );
    } else {
      current.document += sourcePrincipal(row.sourceAmount);
    }
    const fx = Number(row.fxGainLossAmount ?? 0);
    if (!Number.isFinite(fx)) throw new Error("Settlement FX must be finite");
    current.base +=
      nonnegativeAmount(
        Number(row.appliedAmount),
        "Settlement applied amount"
      ) +
      (isAR ? 1 : -1) * fx;
    consumed.set(sourceId, current);
  }
  return payments
    .map((payment) => {
      const precision = precisionFor(payment);
      const use = consumed.get(payment.id);
      const total = nonnegativeAmount(
        Number(payment.totalAmount),
        "Funding document total"
      );
      const remainingDocument = toDocumentAmount(
        total - (use?.document ?? 0),
        1,
        precision
      );
      const remainingBase = round(
        toBaseAmount(total, Number(payment.exchangeRate)) - (use?.base ?? 0)
      );
      if (
        remainingDocument < 0 ||
        remainingBase < 0 ||
        (remainingDocument === 0 && remainingBase !== 0)
      ) {
        throw new Error(
          `Invalid remaining funding balance for payment ${payment.id}`
        );
      }
      const source: FundingSource = {
        paymentId: payment.id,
        postingDate: payment.postingDate ?? payment.paymentDate,
        exchangeRate: Number(payment.exchangeRate),
        remainingDocument,
        remainingBase
      };
      if (payment.scope) source.scope = payment.scope;
      return source;
    })
    .filter((payment) => payment.remainingDocument > 0);
}
