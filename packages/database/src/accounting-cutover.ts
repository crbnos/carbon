// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The pure decisions of the accounting cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md sections 4 and 5): the opening
// journal, Migration Clearing per control account, the inventory reset and
// the re-costing of outbound movements after the cutover date. No database
// reads or writes here — the enable transaction feeds these and writes what
// they return.

import { parseDate } from "@internationalized/date";
import {
  type CostingMethod,
  type ReliefEvent,
  type ReliefLayer,
  replayReliefs
} from "./cost-relief";
import { type AccountClass, debitSigned } from "./ledger";
import { assertBalanced, EPSILON, equals, round } from "./precision";
import type { Database } from "./types";

/** The document type a journal line carries. */
export type JournalLineDocumentType =
  Database["public"]["Enums"]["journalLineDocumentType"];

export type { AccountClass } from "./ledger";

/** Migration Clearing must total zero within this for the enable. */
export const MIGRATION_CLEARING_TOLERANCE = 0.01;

/** True when Migration Clearing totals zero within the tolerance. */
export function isMigrationClearingZero(total: number): boolean {
  return equals(total, 0, MIGRATION_CLEARING_TOLERANCE);
}

/** The search param the enable wizard carries the cutover date in. */
export const ACTIVATION_CUTOVER_PARAM = "cutover";

/** The day before the cutover: the date the opening journal carries. */
export function dayBeforeCutover(cutoverDate: string): string {
  return parseDate(cutoverDate).subtract({ days: 1 }).toString();
}

/**
 * The class the Migration Clearing account must have. Readiness refuses any
 * other, and the opening journal refuses to be built on one.
 */
export const MIGRATION_CLEARING_ACCOUNT_CLASS: AccountClass = "Equity";

/** The Migration Clearing account default, with its class. */
export type MigrationClearingAccount = {
  accountId: string;
  accountClass: AccountClass;
};

export type OpenItemType =
  | "Receivable"
  | "Payable"
  | "Reimbursement"
  | "Unapplied Credit"
  | "Customer Deposit"
  | "Received Not Invoiced"
  | "Work in Progress"
  | "Inventory"
  | "Fixed Asset Cost"
  | "Accumulated Depreciation"
  | "Deferred Revenue"
  | "Lease Net Investment";

/**
 * One item open at the cutover, in base currency, positive on the natural
 * side of its account. `amount` is `originalAmount − settledBeforeCutover`.
 * A document partly settled before the cutover keeps its original amount
 * because the payment lookup and the AR/AP readers subtract every settlement
 * from the original control line, the settlements before the cutover
 * included. An item that is not a document has `settledBeforeCutover = 0`.
 */
export type OpenItem = {
  openItemType: OpenItemType;
  accountId: string;
  accountClass: AccountClass;
  amount: number;
  originalAmount: number;
  settledBeforeCutover: number;
  documentType: JournalLineDocumentType | null;
  documentId: string | null;
  documentLineReference: string | null;
  description: string;
  /** The original line's quantity, for a reader that costs by quantity. */
  quantity?: number | null;
  /**
   * How the part settled before the cutover is keyed. Without it, that line
   * keeps the item's keys under "<description> (settled before cutover)".
   * Received-not-invoiced uses it: the invoices before the cutover cleared
   * GR/IR under `purchase-invoice:<poLineId>`, which the purchase invoice's
   * GR/IR walk does not read.
   */
  settled?: {
    documentLineReference: string | null;
    description: string;
    quantity?: number | null;
  } | null;
};

/** A line of the prior system's trial balance as of the day before the cutover. */
export type TrialBalanceLine = {
  accountId: string;
  accountClass: AccountClass;
  debit: number;
  credit: number;
};

export type OpeningJournalLine = {
  accountId: string;
  /** Natural-balance-signed, as every journal line in Carbon. */
  amount: number;
  description: string;
  documentType: JournalLineDocumentType | null;
  documentId: string | null;
  documentLineReference: string | null;
  quantity: number | null;
};

export const SETTLED_BEFORE_CUTOVER_SUFFIX = " (settled before cutover)";
export const MIGRATION_CLEARING_DESCRIPTION = "Migration Clearing";
export const OPENING_BALANCE_DESCRIPTION = "Opening Balance";

function netDebit(line: TrialBalanceLine) {
  return line.debit - line.credit;
}

/**
 * The opening journal's lines:
 * - per open item, its original amount with its own description and
 *   document keys, and, when part was settled before the cutover, that part
 *   with the opposite sign under a description the readers ignore;
 * - one Migration Clearing line per control account offsetting its items;
 * - per trial balance row on a non-control account, a line on that account
 *   and a Migration Clearing line offsetting it.
 * A trial balance row on a control account is an assertion only (it feeds
 * `migrationClearingByAccount`), never a line.
 *
 * Migration Clearing must be an Equity account; the lines are signed by its
 * class, and the function refuses lines that do not balance.
 */
export function buildOpeningJournalLines(
  items: OpenItem[],
  trialBalance: TrialBalanceLine[],
  controlAccountIds: ReadonlySet<string>,
  clearing: MigrationClearingAccount
): OpeningJournalLine[] {
  if (clearing.accountClass !== MIGRATION_CLEARING_ACCOUNT_CLASS) {
    throw new Error(
      `Migration Clearing must be an ${MIGRATION_CLEARING_ACCOUNT_CLASS} account, not ${clearing.accountClass}`
    );
  }

  const lines: OpeningJournalLine[] = [];
  const classByAccount = new Map<string, AccountClass>([
    [clearing.accountId, clearing.accountClass]
  ]);
  const debitByControlAccount = new Map<string, number>();

  for (const item of items) {
    if (!controlAccountIds.has(item.accountId)) {
      throw new Error(
        `Open item on ${item.accountId} is not on a control account`
      );
    }
    classByAccount.set(item.accountId, item.accountClass);
    const keys = {
      documentType: item.documentType,
      documentId: item.documentId,
      documentLineReference: item.documentLineReference
    };
    lines.push({
      accountId: item.accountId,
      amount: round(item.originalAmount),
      description: item.description,
      ...keys,
      quantity: item.quantity ?? null
    });
    if (Math.abs(item.settledBeforeCutover) > EPSILON) {
      lines.push({
        accountId: item.accountId,
        amount: round(-item.settledBeforeCutover),
        ...(item.settled
          ? {
              ...keys,
              description: item.settled.description,
              documentLineReference: item.settled.documentLineReference,
              quantity: item.settled.quantity ?? null
            }
          : {
              ...keys,
              description: `${item.description}${SETTLED_BEFORE_CUTOVER_SUFFIX}`,
              quantity: null
            })
      });
    }
    debitByControlAccount.set(
      item.accountId,
      (debitByControlAccount.get(item.accountId) ?? 0) +
        debitSigned(item.accountClass, item.amount)
    );
  }

  for (const [accountId, debitValue] of debitByControlAccount) {
    if (Math.abs(debitValue) <= EPSILON) continue;
    lines.push({
      accountId: clearing.accountId,
      amount: round(debitSigned(clearing.accountClass, -debitValue)),
      description: MIGRATION_CLEARING_DESCRIPTION,
      documentType: null,
      documentId: null,
      documentLineReference: accountId,
      quantity: null
    });
  }

  for (const row of trialBalance) {
    if (controlAccountIds.has(row.accountId)) continue;
    const debitValue = netDebit(row);
    if (Math.abs(debitValue) <= EPSILON) continue;
    classByAccount.set(row.accountId, row.accountClass);
    lines.push({
      accountId: row.accountId,
      amount: round(debitSigned(row.accountClass, debitValue)),
      description: OPENING_BALANCE_DESCRIPTION,
      documentType: null,
      documentId: null,
      documentLineReference: null,
      quantity: null
    });
    lines.push({
      accountId: clearing.accountId,
      amount: round(debitSigned(clearing.accountClass, -debitValue)),
      description: MIGRATION_CLEARING_DESCRIPTION,
      documentType: null,
      documentId: null,
      documentLineReference: row.accountId,
      quantity: null
    });
  }

  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    const accountClass = classByAccount.get(line.accountId);
    if (!accountClass) {
      throw new Error(`Opening journal line on ${line.accountId} has no class`);
    }
    const debitValue = debitSigned(accountClass, line.amount);
    if (debitValue > 0) debits += debitValue;
    else credits -= debitValue;
  }
  assertBalanced(debits, credits, EPSILON, "Opening journal");

  return lines;
}

export type MigrationClearingRow = {
  accountId: string;
  /** Debit-signed balance the prior system's trial balance asserts. */
  trialBalance: number;
  /** Debit-signed balance of Carbon's open items on the account. */
  carbon: number;
  difference: number;
};

/**
 * Migration Clearing per control account, and its total. The total is the
 * debit-signed balance Migration Clearing ends at after the opening journal:
 * the sum of the control-account differences plus any imbalance of the trial
 * balance itself. The enable needs it to be zero.
 */
export function migrationClearingByAccount(
  items: OpenItem[],
  trialBalance: TrialBalanceLine[],
  controlAccountIds: ReadonlySet<string>
): { rows: MigrationClearingRow[]; total: number } {
  const carbon = new Map<string, number>();
  for (const item of items) {
    carbon.set(
      item.accountId,
      (carbon.get(item.accountId) ?? 0) +
        debitSigned(item.accountClass, item.amount)
    );
  }
  const asserted = new Map<string, number>();
  let nonControlDebit = 0;
  for (const row of trialBalance) {
    if (controlAccountIds.has(row.accountId)) {
      asserted.set(
        row.accountId,
        (asserted.get(row.accountId) ?? 0) + netDebit(row)
      );
    } else {
      nonControlDebit += netDebit(row);
    }
  }

  const rows = [...controlAccountIds].map((accountId) => {
    const trialBalanceAmount = round(asserted.get(accountId) ?? 0);
    const carbonAmount = round(carbon.get(accountId) ?? 0);
    return {
      accountId,
      trialBalance: trialBalanceAmount,
      carbon: carbonAmount,
      difference: round(trialBalanceAmount - carbonAmount)
    };
  });

  const itemsDebit = [...carbon.values()].reduce((sum, v) => sum + v, 0);
  // The clearing lines offset every item and every non-control trial balance
  // row, so the clearing account ends at minus their debit total.
  const total = round(-(itemsDebit + nonControlDebit));
  return { rows, total: total === 0 ? 0 : total };
}

/** The layer that opens an item's stock at the cutover. */
export type OpeningLayer = {
  itemId: string;
  quantity: number;
  cost: number;
};

/**
 * The inventory reset as of the cutover date: one opening layer per item with
 * stock, at the reviewed unit cost. The caller closes every layer dated
 * before the cutover. Cost layers have no location, so on-hand is per item.
 */
export function planInventoryReset(
  onHandAtCutover: { itemId: string; quantity: number }[],
  unitCostByItem: ReadonlyMap<string, number>
): OpeningLayer[] {
  return onHandAtCutover.flatMap(({ itemId, quantity }) => {
    if (quantity <= EPSILON) return [];
    const unitCost = unitCostByItem.get(itemId);
    if (unitCost === undefined) {
      throw new Error(
        `Item ${itemId} has stock at the cutover but no unit cost`
      );
    }
    return [
      { itemId, quantity: round(quantity), cost: round(quantity * unitCost) }
    ];
  });
}

/** A cost layer dated before the cutover, with its cost adjustments included. */
export type LayerBeforeCutover = { quantity: number; cost: number };

/**
 * The value of an item's stock at the cutover, replayed from its layers
 * dated before the cutover (oldest first). Relief before the cutover took
 * the oldest layers for FIFO and the newest for LIFO, so the stock left sits
 * in the newest layers for FIFO and the oldest for LIFO. Today's remaining
 * quantity cannot answer this: relief after the cutover has changed it.
 * A quantity no layer covers is valued at `fallbackUnitCost`.
 */
export function unitCostAtCutover(
  layers: LayerBeforeCutover[],
  onHandAtCutover: number,
  costingMethod: "FIFO" | "LIFO",
  fallbackUnitCost: number
): number {
  if (onHandAtCutover <= EPSILON) return fallbackUnitCost;
  const ordered = costingMethod === "FIFO" ? [...layers].reverse() : layers;
  let toCover = onHandAtCutover;
  let value = 0;
  for (const layer of ordered) {
    if (toCover <= EPSILON) break;
    if (layer.quantity <= EPSILON) continue;
    const take = Math.min(toCover, layer.quantity);
    value += (take * layer.cost) / layer.quantity;
    toCover -= take;
  }
  if (toCover > EPSILON) value += toCover * fallbackUnitCost;
  return round(value / onHandAtCutover);
}

/** A layer the re-cost opens: the opening layer or an inbound layer after
 *  the cutover, at its full quantity, with its adjustment children. */
export type RecostLayer = ReliefLayer & { itemId: string };

/** An outbound movement after the cutover; quantity and cost are positive. */
export type RecostOutbound = {
  costLedgerId: string;
  itemId: string;
  quantity: number;
  cost: number;
  /** The serial units leaving with it. */
  trackedEntityIds: readonly string[];
};

/** The re-cost's ledger, in order: the opening layers first, then every
 *  inbound layer and outbound movement after the cutover as it was posted. */
export type RecostEvent = { layer: RecostLayer } | { outbound: RecostOutbound };

/**
 * Re-costs the outbound movements dated on or after the cutover against the
 * reset layers: the events run in order, each outbound movement relieving the
 * layers open at that point as `calculateCOGS` relieves them
 * (`replayReliefs`). Only FIFO and LIFO items relieve layers; the caller
 * passes those only, as Standard and Average cost from `itemCost`. Returns
 * each movement's new cost and its difference from the stored one, and the
 * remaining quantity of every layer and child.
 */
export function recostOutbound(
  events: readonly RecostEvent[],
  methodByItem: ReadonlyMap<string, CostingMethod>,
  fallbackUnitCostByItem: ReadonlyMap<string, number>
): {
  movements: { costLedgerId: string; newCost: number; delta: number }[];
  remainingById: Map<string, number>;
} {
  const outbound = events.flatMap((event) =>
    "outbound" in event ? [event.outbound] : []
  );
  const { costByKey, remainingById } = replayReliefs({
    events: events.map(
      (event): ReliefEvent =>
        "layer" in event
          ? { kind: "layer", itemId: event.layer.itemId, layer: event.layer }
          : {
              kind: "relief",
              key: event.outbound.costLedgerId,
              itemId: event.outbound.itemId,
              quantity: event.outbound.quantity,
              trackedEntityIds: event.outbound.trackedEntityIds
            }
    ),
    methodByItem,
    fallbackUnitCostByItem
  });
  return {
    movements: outbound.map((movement) => {
      const newCost = costByKey.get(movement.costLedgerId) ?? 0;
      return {
        costLedgerId: movement.costLedgerId,
        newCost,
        delta: round(newCost - movement.cost)
      };
    }),
    remainingById
  };
}
