// Pure RuleContext assembly for storage-rules evaluation. Deliberately
// side-effect-free (no auth/env/DB imports) so the registry↔code-path contract
// can be unit-tested without booting the server environment. `server.ts` owns
// the DB I/O and calls `buildLineContext` with the rows it loaded.

import type { RuleContext, TransactionSurface } from "@carbon/utils";

export type RuleLineInput = {
  /** Diagnostic identifier — not used in eval. */
  lineId: string;
  /**
   * Item the line operates on. Required when `targetType === "item"`.
   * Available for context in storageUnit/workCenter passes too.
   */
  itemId?: string | null;
  /** Storage unit being interacted with. */
  storageUnitId?: string | null;
  /** Work center being operated. Required when `targetType === "workCenter"`. */
  workCenterId?: string | null;
  /** Operation context for workCenter passes. */
  operation?: {
    id?: string | null;
    itemId?: string | null;
    quantity?: number | null;
    workInstructionId?: string | null;
  };
  /** Quantity for `transaction.quantity` predicates. */
  quantity: number;
  locationId?: string | null;
};

export type ItemCtxRow = Record<string, unknown> & {
  customFields?: Record<string, unknown>;
};

/**
 * `itemPostingGroupId` lives on the 1:1 `itemCost` row, which PostgREST embeds
 * as a (typed one-to-many) array. Pull the value off the embed regardless of
 * array/object shape. Returns null when absent — callers coalesce to undefined
 * if their context prefers it.
 */
export const itemPostingGroupIdFromEmbed = (
  itemCost: unknown
): string | null => {
  const cost = Array.isArray(itemCost) ? itemCost[0] : itemCost;
  return (
    (cost as { itemPostingGroupId?: string | null } | undefined)
      ?.itemPostingGroupId ?? null
  );
};
export type StorageUnitCtxRow = Record<string, unknown> & {
  locationId?: string | null;
};
export type WorkCenterCtxRow = Record<string, unknown>;

/**
 * Assemble the `RuleContext` for a single line. Pure — so the registry↔code-path
 * contract (which root contexts get populated per surface) can be unit-tested
 * without a DB client. See the anti-drift test in `server.test.ts` and
 * `SURFACE_CONTEXT_AVAILABILITY` in `@carbon/utils`.
 *
 * `item`/`storageUnit`/`workCenter` are the rows loaded from the DB (or
 * undefined when the lookup missed); the id-only fallback keeps token
 * interpolation working when a join didn't materialize (RLS, late insert).
 */
export const buildLineContext = (args: {
  line: RuleLineInput;
  surface: TransactionSurface;
  userId: string;
  item?: ItemCtxRow;
  storageUnit?: StorageUnitCtxRow;
  workCenter?: WorkCenterCtxRow;
}): RuleContext => {
  const { line, surface, userId } = args;
  const storageUnit = line.storageUnitId
    ? (args.storageUnit ?? { id: line.storageUnitId })
    : undefined;
  return {
    item: line.itemId ? (args.item ?? { id: line.itemId }) : undefined,
    storageUnit,
    workCenter: line.workCenterId
      ? (args.workCenter ?? { id: line.workCenterId })
      : undefined,
    operation: line.operation
      ? {
          id: line.operation.id ?? undefined,
          itemId: line.operation.itemId ?? undefined,
          quantity: line.operation.quantity ?? undefined,
          workInstructionId: line.operation.workInstructionId ?? undefined
        }
      : undefined,
    transaction: {
      kind: surface,
      locationId: line.locationId ?? storageUnit?.locationId ?? null,
      quantity: line.quantity,
      userId
    }
  };
};
