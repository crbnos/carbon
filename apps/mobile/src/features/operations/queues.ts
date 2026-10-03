// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard, OperationQueueItem } from "@carbon/mes-core";

/**
 * The two decisions the Assigned / Active / Recent queues make, as pure
 * functions over plain values — kept out of the components because a test that
 * imports a `.tsx` pulls in `react-native`, whose Flow-typed source vitest
 * cannot parse (the same reason `logic.ts` exists).
 *
 * Both are silent when wrong: a card that reads the wrong due date still
 * renders, and a search that misses a field just looks like the operation is
 * not there.
 */

/** The three personal queues. Each is one endpoint and one RPC. */
export type QueueKind = "assigned" | "active" | "recent";

export const QUEUE_KINDS: readonly QueueKind[] = [
  "assigned",
  "active",
  "recent"
];

/**
 * A queue row onto the card `OperationCard` already renders.
 *
 * The one real choice here is the DUE DATE, and web MES makes it twice,
 * differently: `OperationsList` — the flat card list all three of these screens
 * render on the web — shows the JOB's due date and deadline type, while the
 * Kanban board maps the OPERATION's own due date into `Item.dueDate`. These are
 * the list, so they take the job's, and the wire carries both so this stays a
 * choice rather than a server decision.
 *
 * `quantity` / `targetQuantity` are both carried because the card shows
 * `targetQuantity ?? quantity`: an operation with no explicit target must still
 * show a number, not a blank.
 */
export function toOperationCard(operation: OperationQueueItem): OperationCard {
  return {
    id: operation.id,
    jobReadableId: operation.jobReadableId ?? null,
    itemReadableId: operation.itemReadableId ?? null,
    itemDescription: operation.itemDescription ?? null,
    description: operation.description ?? null,
    status: operation.operationStatus ?? null,
    dueDate: operation.jobDueDate ?? null,
    deadlineType: operation.jobDeadlineType ?? null,
    quantity: operation.operationQuantity ?? null,
    targetQuantity: operation.targetQuantity ?? null,
    quantityCompleted: operation.quantityComplete ?? null,
    quantityScrapped: operation.quantityScrapped ?? null,
    columnId: operation.workCenterId ?? null,
    thumbnailPath: operation.thumbnailPath ?? null,
    salesOrderReadableId: operation.salesOrderReadableId ?? null
  };
}

/**
 * The queue search, over the same FOUR fields web MES searches on all three of
 * these screens (`assigned.tsx`, `active.tsx`, `recent.tsx` each filter on
 * description, job id, item id and item description) — case-insensitively, and
 * on substrings, so "brack" finds "Bracket".
 *
 * An empty or whitespace-only term is not a filter: it returns the list
 * untouched rather than nothing.
 */
export function filterOperationCards(
  cards: OperationCard[],
  term: string
): OperationCard[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return cards;
  return cards.filter((card) =>
    [
      card.description,
      card.jobReadableId,
      card.itemReadableId,
      card.itemDescription
    ].some((field) => field?.toLowerCase().includes(needle))
  );
}
