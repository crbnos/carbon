// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Issuing a serial- or batch-tracked part: which entity a scan names, which
 * ones may be picked, and what the request says.
 *
 * Pure, and shared by the operation screen and the assembly screen. Which lot
 * went into which unit is the whole of traceability, and each rule here is one
 * that fails silently: a prefix match issues the wrong lot, a parent and child
 * swapped consumes a unit into itself.
 */

/** A tracked entity on the shelf, as far as issuing one needs to know. */
export type AvailableEntity = {
  id: string;
  readableId?: string | null;
  quantity: number;
  status?: string | null;
  expirationDate?: string | null;
};

/**
 * The entity a scanned label names, or null.
 *
 * Exact and case-insensitive on the entity id or its readable id — the two
 * things Carbon prints on a serial or lot label. Never a prefix match: "LOT-1"
 * must not issue "LOT-10", and the wrong lot in a unit's genealogy is the
 * mistake traceability exists to prevent.
 */
export function matchEntityToScan<E extends AvailableEntity>(
  entities: E[],
  code: string
): E | null {
  const needle = code.trim().toLowerCase();
  if (!needle) return null;
  return (
    entities.find(
      (entity) =>
        entity.id.toLowerCase() === needle ||
        (entity.readableId != null &&
          entity.readableId.trim().toLowerCase() === needle)
    ) ?? null
  );
}

/**
 * Whether a lot or serial is past its expiry on `today` (both `YYYY-MM-DD`).
 *
 * A plain string comparison is exact here: an ISO date sorts lexicographically
 * in calendar order, and it is how the supersession rules compare dates too.
 * Expiring TODAY is not expired — web compares `< today` the same way.
 */
export function isExpired(
  expirationDate: string | null | undefined,
  today: string
) {
  if (!expirationDate) return false;
  return expirationDate.slice(0, 10) < today;
}

/**
 * The entities an operator may pick, under the company's expiry policy.
 *
 * `Block` removes expired stock from the list altogether — it is not a valid
 * choice, so it is not offered. `Warn` and `BlockWithOverride` keep it visible
 * and flagged; the second also needs a reason before the server accepts it.
 */
export function selectableEntities<E extends AvailableEntity>(
  entities: E[],
  policy: string,
  today: string
): (E & { expired: boolean })[] {
  return entities
    .map((entity) => ({
      ...entity,
      expired: isExpired(entity.expirationDate, today)
    }))
    .filter((entity) => (policy === "Block" ? !entity.expired : true));
}

/**
 * The body of a tracked issue.
 *
 * **The parent is the unit being built; the children are the parts going into
 * it.** This app once sent the unit's own entity as the child, which asks the
 * server to consume a unit into itself. The two are named apart here, and the
 * request is built in one place, so a sheet cannot swap them again.
 *
 * `jobOperationStepId` and the 1-based `unitNumber` are the assembly screen's:
 * they are what lets a batch parent — one lot shared by every unit — attribute
 * a consume to the unit it was scanned for.
 *
 * An expired entity travels with `overrideExpired` only when the operator gave
 * a reason, exactly as web's modal does; without one the server applies the
 * company's policy on its own.
 */
export function trackedIssueBody(args: {
  materialId: string | null | undefined;
  /** Only used when there is no material line: an unplanned tracked part. */
  itemId?: string | null;
  /** The unit being built — what the issued entities become children of. */
  parentEntityId: string;
  children: { trackedEntityId: string; quantity: number }[];
  jobOperationStepId?: string;
  unitNumber?: number;
  overrideReason?: string;
}) {
  const reason = args.overrideReason?.trim();
  return {
    ...(args.materialId
      ? { materialId: args.materialId }
      : { itemId: args.itemId ?? undefined }),
    parentTrackedEntityId: args.parentEntityId,
    children: args.children,
    ...(args.jobOperationStepId
      ? { jobOperationStepId: args.jobOperationStepId }
      : {}),
    ...(args.unitNumber !== undefined ? { unitNumber: args.unitNumber } : {}),
    ...(reason ? { overrideExpired: true, overrideReason: reason } : {})
  };
}

/**
 * How many more of a tracked part can still be selected.
 *
 * A serial part is one entity per piece, so the selection is capped at what
 * the line still needs — a fourth serial scanned onto a part that needs three
 * is a mis-scan, not an extra. With nothing outstanding one more is allowed:
 * an operator replacing a damaged part has to be able to issue it.
 */
export function serialSlotsLeft(args: {
  required: number;
  issued: number;
  selected: number;
}) {
  const outstanding = args.required - args.issued;
  const cap = outstanding > 0 ? outstanding : 1;
  const left = cap - args.selected;
  return left > 0 ? left : 0;
}
