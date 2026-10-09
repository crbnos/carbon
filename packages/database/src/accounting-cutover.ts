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
import { type AccountClass, debitSigned } from "./ledger";
import { assertBalanced, EPSILON, equals, round } from "./precision";

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
  documentType: string | null;
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
  documentType: string | null;
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
  migrationClearing: MigrationClearingAccount
): OpeningJournalLine[];
/**
 * @deprecated Pass the Migration Clearing account with its class. The id
 * alone takes the class readiness requires (`MIGRATION_CLEARING_ACCOUNT_CLASS`);
 * the enable re-runs readiness before it builds the opening journal.
 */
export function buildOpeningJournalLines(
  items: OpenItem[],
  trialBalance: TrialBalanceLine[],
  controlAccountIds: ReadonlySet<string>,
  migrationClearingAccountId: string
): OpeningJournalLine[];
export function buildOpeningJournalLines(
  items: OpenItem[],
  trialBalance: TrialBalanceLine[],
  controlAccountIds: ReadonlySet<string>,
  migrationClearingAccount: MigrationClearingAccount | string
): OpeningJournalLine[] {
  const clearing =
    typeof migrationClearingAccount === "string"
      ? {
          accountId: migrationClearingAccount,
          accountClass: MIGRATION_CLEARING_ACCOUNT_CLASS
        }
      : migrationClearingAccount;
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

export type CostLayerBeforeCutover = { id: string; itemId: string };
export type OpeningLayer = {
  itemId: string;
  quantity: number;
  cost: number;
  remainingQuantity: number;
};

/**
 * The inventory reset as of the cutover date: close every cost layer dated
 * before it and open one layer per item with stock, at the reviewed unit
 * cost. Cost layers have no location, so on-hand is per item.
 */
export function planInventoryReset(
  onHandAtCutover: { itemId: string; quantity: number }[],
  unitCostByItem: ReadonlyMap<string, number>,
  layersBeforeCutover: CostLayerBeforeCutover[]
): { layerIdsToClose: string[]; openingLayers: OpeningLayer[] } {
  const openingLayers: OpeningLayer[] = [];
  for (const { itemId, quantity } of onHandAtCutover) {
    if (quantity <= EPSILON) continue;
    const unitCost = unitCostByItem.get(itemId);
    if (unitCost === undefined) {
      throw new Error(
        `Item ${itemId} has stock at the cutover but no unit cost`
      );
    }
    openingLayers.push({
      itemId,
      quantity: round(quantity),
      cost: round(quantity * unitCost),
      remainingQuantity: round(quantity)
    });
  }
  return {
    layerIdsToClose: layersBeforeCutover.map((layer) => layer.id),
    openingLayers
  };
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

/**
 * A layer a re-cost draws from: the opening layer or an inbound layer after
 * the cutover. `postingDate` is `YYYY-MM-DD`; the opening layer carries the
 * cutover date.
 */
export type RecostLayer = {
  key: string;
  itemId: string;
  postingDate: string;
  quantity: number;
  cost: number;
  remainingQuantity: number;
};

/** An outbound movement after the cutover; quantity and cost are positive. */
export type OutboundMovement = {
  costLedgerId: string;
  itemId: string;
  postingDate: string;
  quantity: number;
  cost: number;
};

/**
 * Re-costs the outbound movements dated on or after the cutover against the
 * reset layers. Pass layers oldest first and movements in date then entry
 * order. A movement draws only from layers dated on or before it: the oldest
 * first for a FIFO item, the newest first for a LIFO item. Only FIFO/LIFO
 * items relieve layers — the caller passes those only; Standard and Average
 * cost from `itemCost`. A quantity no layer covers is costed at
 * `fallbackUnitCostByItem`, as `calculateCOGS` costs negative inventory.
 */
export function recostOutbound(
  layers: RecostLayer[],
  outbound: OutboundMovement[],
  fallbackUnitCostByItem: ReadonlyMap<string, number>,
  costingMethodByItem: ReadonlyMap<string, "FIFO" | "LIFO"> = new Map()
): {
  movements: { costLedgerId: string; newCost: number; delta: number }[];
  remainingByLayer: Map<string, number>;
} {
  const open = layers.map((layer) => ({ ...layer }));
  // Each item's layers, oldest first, grouped once.
  const openByItem = new Map<string, typeof open>();
  for (const layer of open) {
    const list = openByItem.get(layer.itemId);
    if (list) list.push(layer);
    else openByItem.set(layer.itemId, [layer]);
  }
  const movements = outbound.map((movement) => {
    let toRelieve = movement.quantity;
    let newCost = 0;
    const eligible = (openByItem.get(movement.itemId) ?? []).filter(
      (layer) => layer.postingDate <= movement.postingDate
    );
    if (costingMethodByItem.get(movement.itemId) === "LIFO") eligible.reverse();
    for (const layer of eligible) {
      if (toRelieve <= EPSILON) break;
      if (layer.remainingQuantity <= EPSILON) continue;
      const unitCost = layer.quantity > 0 ? layer.cost / layer.quantity : 0;
      const take = Math.min(toRelieve, layer.remainingQuantity);
      newCost += take * unitCost;
      layer.remainingQuantity -= take;
      toRelieve -= take;
    }
    if (toRelieve > EPSILON) {
      newCost += toRelieve * (fallbackUnitCostByItem.get(movement.itemId) ?? 0);
    }
    const rounded = round(newCost);
    return {
      costLedgerId: movement.costLedgerId,
      newCost: rounded,
      delta: round(rounded - movement.cost)
    };
  });
  return {
    movements,
    remainingByLayer: new Map(
      open.map((layer) => [layer.key, round(layer.remainingQuantity)])
    )
  };
}
