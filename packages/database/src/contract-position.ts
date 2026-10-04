// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A contract line's position: invoiced − recognized. Deferred Revenue carries
// the positive part, Contract Assets the negative part, and every movement —
// an invoice, a recognition, a credit memo, a VOID, the opening balance of a
// migrated contract — goes through `applyContractMovement`, so invoice
// posting, post-memo and the recognition run can never disagree about which
// account a movement hits.
//
// Both pools are kept in contract currency and in base. Base is carried at a
// weighted-average rate per pool (SAP RAR; .ai/research/contract-exchange-rates.md
// open question 7): drawing on a pool takes its carried base, adding to it
// takes the movement's own rate. When the other side of the entry is a
// receivable (an invoice or a credit), the receivable is at the document's
// rate and the difference is realized FX — never revenue. When it is revenue
// (the recognition run), revenue takes exactly the base the pools move.
// Plan: .ai/plans/2026-10-04-contracts-wizard-phase-b.md (D3, D4)

import { toBaseAmount } from "./accounting-currency.ts";
import { EPSILON, round } from "./precision.ts";

export type ContractPosition = {
  deferredAmount: number;
  deferredBase: number;
  assetAmount: number;
  assetBase: number;
};

export const EMPTY_POSITION: ContractPosition = {
  deferredAmount: 0,
  deferredBase: 0,
  assetAmount: 0,
  assetBase: 0
};

/** One movement's effect: the pool deltas (signed, what the ledger entry
 *  stores), the base of the other side of the entry, and the FX difference. */
export type ContractMovement = ContractPosition & {
  /** The receivable or revenue side of the entry, in base, as a magnitude. */
  counterBase: number;
  /**
   * Receivable counterparts only: receivable base − the base the pools moved.
   * For a funding movement (an invoice) a positive value is a gain (credit);
   * for a reducing one (a credit) a positive value is a loss (debit). Always 0
   * against revenue.
   */
  fxBase: number;
};

/** Σ of a line's ledger entries. */
export function positionFromEntries(
  entries: Partial<ContractPosition>[]
): ContractPosition {
  let deferredAmount = 0;
  let deferredBase = 0;
  let assetAmount = 0;
  let assetBase = 0;
  for (const entry of entries) {
    deferredAmount += Number(entry.deferredAmount ?? 0);
    deferredBase += Number(entry.deferredBase ?? 0);
    assetAmount += Number(entry.assetAmount ?? 0);
    assetBase += Number(entry.assetBase ?? 0);
  }
  return {
    deferredAmount: round(deferredAmount),
    deferredBase: round(deferredBase),
    assetAmount: round(assetAmount),
    assetBase: round(assetBase)
  };
}

/** The base carried by `draw` of a pool of `amount` worth `base`. Drawing the
 *  whole pool takes its whole base, so no residue is ever left behind. */
function carriedBase(amount: number, base: number, draw: number): number {
  if (draw <= 0) return 0;
  if (draw >= amount - EPSILON) return base;
  return round((base * draw) / amount);
}

/**
 * Apply a movement of `amount` (contract currency) to a line's position.
 * - `amount > 0` raises the position (an invoice, a reversed recognition):
 *   it clears Contract Assets first, then adds to Deferred Revenue.
 * - `amount < 0` lowers it (a recognition, a credit memo, a VOID): it releases
 *   Deferred Revenue first, then adds to Contract Assets.
 * `rate` is the movement's own rate, foreign units per base unit.
 */
export function applyContractMovement(args: {
  position: ContractPosition;
  amount: number;
  rate: number;
  counterpart: "receivable" | "revenue";
}): ContractMovement {
  const { position, rate, counterpart } = args;
  const amount = round(args.amount);
  const magnitude = Math.abs(amount);
  const movement: ContractMovement = {
    ...EMPTY_POSITION,
    counterBase: 0,
    fxBase: 0
  };
  if (magnitude < EPSILON) return movement;

  // The pool drawn first, then the pool the remainder lands in.
  const raising = amount > 0;
  const drawPool = raising
    ? { amount: position.assetAmount, base: position.assetBase }
    : { amount: position.deferredAmount, base: position.deferredBase };
  const drawn = Math.min(magnitude, Math.max(drawPool.amount, 0));
  const drawnBase = carriedBase(drawPool.amount, drawPool.base, drawn);
  const rest = round(magnitude - drawn);
  const restBase = toBaseAmount(rest, rate);

  if (raising) {
    movement.assetAmount = negate(drawn);
    movement.assetBase = negate(drawnBase);
    movement.deferredAmount = rest;
    movement.deferredBase = restBase;
  } else {
    movement.deferredAmount = negate(drawn);
    movement.deferredBase = negate(drawnBase);
    movement.assetAmount = rest;
    movement.assetBase = restBase;
  }

  const pooledBase = round(drawnBase + restBase);
  if (counterpart === "revenue") {
    movement.counterBase = pooledBase;
  } else {
    movement.counterBase = toBaseAmount(magnitude, rate);
    movement.fxBase = round(movement.counterBase - pooledBase);
  }
  return movement;
}

/** −value, without a −0 for an untouched pool. */
function negate(value: number): number {
  return value === 0 ? 0 : -round(value);
}

/** `position` after `movement`. */
export function addMovement(
  position: ContractPosition,
  movement: ContractPosition
): ContractPosition {
  return positionFromEntries([position, movement]);
}

/** −position, as the entry that undoes it (a VOID of an invoice entry). */
export function negatePosition(position: ContractPosition): ContractPosition {
  return {
    deferredAmount: negate(position.deferredAmount),
    deferredBase: negate(position.deferredBase),
    assetAmount: negate(position.assetAmount),
    assetBase: negate(position.assetBase)
  };
}

/**
 * The reclass that puts a position back in shape: Deferred Revenue holds
 * max(N, 0) and Contract Assets max(−N, 0), never a negative pool. A VOID
 * negates its invoice's entry exactly, so after a recognition the deferred
 * pool can go below zero (billed 30, recognized 10, voided 30 → −10); the
 * reclass moves that into Contract Assets (+10 on both pools, so N is
 * unchanged), carrying the pools' net base across. Returns the delta to add
 * — zeros when no pool is negative. Its deferred and asset base deltas are
 * always equal, so it posts as one Contract Assets / Deferred Revenue pair.
 */
export function normalizePosition(
  position: ContractPosition
): ContractPosition {
  if (position.deferredAmount >= -EPSILON && position.assetAmount >= -EPSILON)
    return { ...EMPTY_POSITION };
  const net = round(position.deferredAmount - position.assetAmount);
  const netBase = round(position.deferredBase - position.assetBase);
  const target: ContractPosition =
    net >= 0
      ? {
          deferredAmount: net,
          deferredBase: netBase,
          assetAmount: 0,
          assetBase: 0
        }
      : {
          deferredAmount: 0,
          deferredBase: 0,
          assetAmount: -net,
          assetBase: -netBase
        };
  return {
    deferredAmount: round(target.deferredAmount - position.deferredAmount),
    deferredBase: round(target.deferredBase - position.deferredBase),
    assetAmount: round(target.assetAmount - position.assetAmount),
    assetBase: round(target.assetBase - position.assetBase)
  };
}

/**
 * A movement's effect on the journal, as signed CREDIT amounts in base
 * (negative = debit): Deferred Revenue (a liability, credited as it grows),
 * Contract Assets (an asset, credited as it shrinks) and the realized FX
 * that makes the three sum to `creditBase` — what the other side of the
 * entry puts on this side (an invoice line's revenue, positive; a credit
 * memo's receivable, negative). `fx > 0` credits the realized gain account,
 * `fx < 0` debits the loss account. Against revenue it is 0.
 */
export function movementCredits(
  movement: ContractPosition,
  creditBase: number
): { deferred: number; asset: number; fx: number } {
  const deferred = round(movement.deferredBase);
  const asset = negate(movement.assetBase);
  return { deferred, asset, fx: round(creditBase - deferred - asset) };
}
