// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  PickingListCard,
  PickingListLine,
  PickingListStatusBody,
  PickingTrackedOptions
} from "@carbon/mes-core";
import { isPickingListLocked } from "@carbon/mes-core";
import { type CalendarDate, parseDate } from "@internationalized/date";

/**
 * Every decision the picking screens make that does not need React Native.
 *
 * Separate from the components for the same practical reason the operations
 * screen's `logic.ts` is: a test that imports a `.tsx` pulls in react-native,
 * whose source is Flow-typed and which vitest cannot parse — so logic living
 * inside a component is logic that cannot be tested.
 *
 * These are the ones worth pinning. Each is silent when wrong: a line counted
 * as resolved when it is not, an expired lot offered as pickable, a lot
 * quantity that over-picks a batch. None of them throw; they just move the
 * wrong material into a kit, and the kit goes to the machine.
 *
 * Nothing here re-derives a rule the server owns. `isPickingListLocked` comes
 * from `@carbon/mes-core` so the app, web MES and the command code cannot
 * disagree about which lists are terminal, and the completion policy
 * (`incompletePickingListPolicy`) is enforced server-side and never guessed at
 * here — the app only reads the 409 it answers with.
 */

export type TrackedLot = PickingTrackedOptions["entities"][number];
export type PickOrder = PickingTrackedOptions["defaultOrder"];
export type ExpiredPolicy = PickingTrackedOptions["expiredEntityPolicy"];

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** What is still owed on a line, floored at zero — never a negative "left". */
export function quantityOutstanding(line: PickingListLine): number {
  const owed = (line.quantityToPick ?? 0) - (line.quantityPicked ?? 0);
  return owed > 0 ? owed : 0;
}

/**
 * Is this line done with, one way or another?
 *
 * Mirrors `isLineResolved` in `x+/picking.$pickingListId.tsx`: Short and
 * Cancelled count as resolved, because the kitter has ANSWERED for them — a
 * short pick is a deliberate "this is all there was", not an omission. A line
 * with nothing to pick is NOT resolved, which is the web's behaviour and is
 * deliberate: `quantityPicked >= 0` would otherwise mark an empty line done.
 */
export function isLineResolved(line: PickingListLine): boolean {
  if (line.status === "Short" || line.status === "Cancelled") return true;
  return (
    (line.quantityToPick ?? 0) > 0 &&
    (line.quantityPicked ?? 0) >= (line.quantityToPick ?? 0)
  );
}

/** Fully picked, as distinct from resolved — a Short line is not this. */
export function isLineFullyPicked(line: PickingListLine): boolean {
  return (
    (line.quantityToPick ?? 0) > 0 &&
    (line.quantityPicked ?? 0) >= (line.quantityToPick ?? 0)
  );
}

export function resolvedLineCount(lines: PickingListLine[]): number {
  return lines.filter(isLineResolved).length;
}

/**
 * No warehouse stock on record for this line's item.
 *
 * `availableQuantity` is the `get_picking_list_availability` RPC's answer, not
 * a column, and it already counts the unassigned bin — so a null source bin is
 * not a shortage while there is on-hand somewhere. A kitter may still pick it
 * (on-hand goes negative until the count is reconciled), which is why this is
 * a warning and never a disabled button.
 */
export function isOutOfStock(line: PickingListLine): boolean {
  return (line.availableQuantity ?? 0) <= 0;
}

export type PickedLot = {
  trackedEntityId: string;
  quantityPicked: number;
  /** The lot number an operator reads off the label, when the embed had one. */
  readableId: string | null;
};

/**
 * The lots actually PICKED for a line, never the ones merely allocated.
 *
 * `quantityPicked > 0` is the test the web uses, and it matters: the
 * recommendation pass allocates lots to lines before anyone touches a shelf,
 * so an allocated-but-unpicked lot would render as an Unpick button for
 * material still in the rack.
 *
 * The readable id arrives through the contract's `.passthrough()` (the server
 * embeds `trackedEntity:trackedEntity(readableId, quantity)`), so the cast is
 * done HERE, once, rather than in every component that shows a chip.
 */
export function pickedLots(line: PickingListLine): PickedLot[] {
  const rows = (line.trackedEntities ?? []) as Array<{
    trackedEntityId: string;
    quantityPicked?: number | null;
    trackedEntity?: { readableId?: string | null } | null;
  }>;
  return rows
    .filter((row) => (row.quantityPicked ?? 0) > 0)
    .map((row) => ({
      trackedEntityId: row.trackedEntityId,
      quantityPicked: row.quantityPicked ?? 0,
      readableId: row.trackedEntity?.readableId ?? null
    }));
}

/** The bin the line says to pick from, when the generator chose one. */
export function lineBinName(line: PickingListLine): string | null {
  return (
    (line as { storageUnit?: { name?: string | null } | null }).storageUnit
      ?.name ?? null
  );
}

export type PickKit = {
  key: string;
  jobReadableId: string | null;
  operationName: string | null;
  workCenterName: string | null;
  lines: PickingListLine[];
};

/**
 * Group lines into kits — one box per job operation.
 *
 * A "kit" is the box a kitter fills for one operation, and parts must not be
 * mixed across operations, so the grouping is not cosmetic: it is the physical
 * boundary. Same key and same sort as `x+/picking.$pickingListId.tsx` (job
 * then operation, both by name) so a kitter who learned the order in a browser
 * finds the same boxes in the same sequence on the tablet.
 *
 * All three labels ride in through `.passthrough()`.
 */
export function groupLinesIntoKits(lines: PickingListLine[]): PickKit[] {
  const groups = new Map<string, PickKit>();
  for (const line of lines) {
    const key = line.jobOperationId ?? "ungrouped";
    let kit = groups.get(key);
    if (!kit) {
      const row = line as {
        job?: { jobId?: string | null } | null;
        jobOperation?: {
          process?: { name?: string | null } | null;
          workCenter?: { name?: string | null } | null;
        } | null;
      };
      kit = {
        key,
        jobReadableId: row.job?.jobId ?? null,
        operationName: row.jobOperation?.process?.name ?? null,
        workCenterName: row.jobOperation?.workCenter?.name ?? null,
        lines: []
      };
      groups.set(key, kit);
    }
    kit.lines.push(line);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const job = (a.jobReadableId ?? "").localeCompare(b.jobReadableId ?? "");
    if (job !== 0) return job;
    return (a.operationName ?? "").localeCompare(b.operationName ?? "");
  });
}

// ---------------------------------------------------------------------------
// The list header
// ---------------------------------------------------------------------------

/** "6 of 14 lines" — a count with context, never a bare number. */
export type ListProgress = { done: number; total: number };

/**
 * The card's progress, from the view's own aggregates.
 *
 * Both columns are nullable in the generated types and come back as 0 on an
 * empty list, so `?? 0` is the honest read rather than a guard against a bug.
 */
export function cardProgress(card: PickingListCard): ListProgress {
  return {
    done: card.completedLineCount ?? 0,
    total: card.lineCount ?? 0
  };
}

export type StatusAction = {
  kind: "start" | "finish";
  status: PickingListStatusBody["status"];
};

/**
 * The one status move this list currently offers, or null when it has none.
 *
 * Draft → In Progress (Start), In Progress → Completed (Finish), and nothing
 * else — the same two transitions `PickingListControls` offers on the web. A
 * locked list returns null, and the CALLER is what differs from the web: web
 * MES hides the controls entirely (`if (isPickingListLocked(status)) return
 * null`), while the shop-floor design rules require the control to stay
 * visible and disabled with a reason. A kitter who cannot find the Finish
 * button assumes the app is broken; one who reads "reopen this from the ERP"
 * knows where to go.
 *
 * Note that Finish asks for `Completed` and may LAND on `Partial`: the server
 * picks the terminal status from the shortfall, and the app shows what came
 * back rather than what it asked for.
 */
export function nextStatusAction(
  status: string | null | undefined
): StatusAction | null {
  if (isPickingListLocked(status)) return null;
  if (status === "Draft") return { kind: "start", status: "In Progress" };
  if (status === "In Progress") return { kind: "finish", status: "Completed" };
  return null;
}

/** The lines the server named in a `blocked` / `needs_acknowledgement` 409. */
export type UnresolvedLine = { itemName: string; outstanding: number };

/**
 * Read `details.unresolvedLines` off a picking 409.
 *
 * `ApiClientError.details` is `unknown` — it is whatever the server put in the
 * error body — so this narrows it defensively and returns an empty list for
 * anything that is not the expected shape. An older server, or a different
 * failure that happens to carry `details`, must leave the confirmation dialog
 * empty rather than crashing the screen that is trying to explain the refusal.
 */
export function unresolvedLinesFrom(details: unknown): UnresolvedLine[] {
  const rows = (details as { unresolvedLines?: unknown } | null | undefined)
    ?.unresolvedLines;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const line = row as { itemName?: unknown; outstanding?: unknown };
    if (typeof line.itemName !== "string") return [];
    return [
      {
        itemName: line.itemName,
        outstanding: typeof line.outstanding === "number" ? line.outstanding : 0
      }
    ];
  });
}

// ---------------------------------------------------------------------------
// Tracked lots: expiry and order
// ---------------------------------------------------------------------------

export type ExpiryState = "expired" | "near" | "ok" | "none";

/**
 * Where a lot's expiry sits relative to the operator's day.
 *
 * `today` is passed in rather than read here, which is what makes this
 * testable AND what keeps JavaScript `Date` out of it. `expirationDate` is a
 * Postgres DATE, so it arrives as `YYYY-MM-DD` — `new Date("2026-10-02")`
 * parses that as UTC midnight and renders the day BEFORE for anyone west of
 * UTC, which on a night shift in California is how a lot that expires
 * tomorrow reads as expired today.
 *
 * `nearExpiryWarningDays` of 0 means only "already expired" is interesting; a
 * lot expiring exactly today is "near", not "expired", matching the web's
 * `exp < today` / `exp <= today + days`.
 *
 * An unparseable date is "none" rather than a throw. The alternative is one
 * malformed row taking down the whole picker.
 */
export function expiryState(
  expirationDate: string | null | undefined,
  nearExpiryWarningDays: number,
  today: CalendarDate
): ExpiryState {
  if (!expirationDate) return "none";
  let expires: CalendarDate;
  try {
    expires = parseDate(expirationDate.slice(0, 10));
  } catch {
    return "none";
  }
  if (expires.compare(today) < 0) return "expired";
  const days = nearExpiryWarningDays > 0 ? nearExpiryWarningDays : 0;
  if (expires.compare(today.add({ days })) <= 0) return "near";
  return "ok";
}

/**
 * May this lot be picked, and what does the operator have to do first?
 *
 * The three company policies mean three genuinely different things, and
 * collapsing any two of them is the mistake worth guarding against:
 *
 *   - `Warn` — pickable. The operator is told it is expired and decides.
 *   - `Block` — NOT pickable. The row stays visible and disabled with the
 *     reason (design rule: never hidden), which is also what the web's
 *     `TrackedEntityPicker` does.
 *   - `BlockWithOverride` — pickable only after an explicit confirmation.
 *
 * Only an EXPIRED lot is ever gated. "Near expiry" is information, not a
 * refusal — a lot that expires next week is exactly the one FEFO wants used
 * first, and gating it would push the kitter onto fresher stock.
 */
export type ExpiryGate = "ok" | "blocked" | "override";

export function expiryGate(
  lot: TrackedLot,
  policy: ExpiredPolicy,
  nearExpiryWarningDays: number,
  today: CalendarDate
): ExpiryGate {
  if (
    expiryState(lot.expirationDate, nearExpiryWarningDays, today) !== "expired"
  ) {
    return "ok";
  }
  if (policy === "Block") return "blocked";
  if (policy === "BlockWithOverride") return "override";
  return "ok";
}

/**
 * The lots in pick order.
 *
 * Mirrors `sortEntities` in `packages/react/src/TrackedEntityPicker.tsx`, down
 * to nulls-last on expiry: a lot with no expiration date must not sort as
 * "expires first" and jump the queue ahead of dated stock that genuinely needs
 * using up. `Default` is the smart order, which is FEFO with a created-at
 * tiebreak — not "whatever the server returned".
 */
export function sortLots(lots: TrackedLot[], order: PickOrder): TrackedLot[] {
  const byExpiry = (a: TrackedLot, b: TrackedLot) => {
    if (!a.expirationDate && !b.expirationDate) return 0;
    if (!a.expirationDate) return 1;
    if (!b.expirationDate) return -1;
    return a.expirationDate.localeCompare(b.expirationDate);
  };
  const byCreated = (dir: 1 | -1) => (a: TrackedLot, b: TrackedLot) =>
    dir * (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

  const copy = [...lots];
  switch (order) {
    case "FEFO":
      return copy.sort((a, b) => byExpiry(a, b) || byCreated(1)(a, b));
    case "FIFO":
      return copy.sort(byCreated(1));
    case "LIFO":
      return copy.sort(byCreated(-1));
    default:
      return copy.sort((a, b) => byExpiry(a, b) || byCreated(1)(a, b));
  }
}

/**
 * How much of a chosen lot one tap picks.
 *
 * A serial is one unit by definition. A batch takes what the line still owes,
 * clamped to what the lot actually holds — picking more than is in the lot
 * would post a movement the shelf cannot back. When the line owes nothing the
 * whole lot is offered, which is the web's `quantityRequired ?? availableQuantity`
 * behaviour: the server floors `quantityRequired` at 0, so 0 is how "nothing
 * outstanding" arrives, and a pick of 0 would be a silent no-op the operator
 * reads as a failure.
 */
export function lotPickQuantity(
  lot: TrackedLot,
  trackingType: string,
  quantityRequired: number
): number {
  if (trackingType === "Serial") return 1;
  const available = lot.availableQuantity ?? 0;
  const wanted = quantityRequired > 0 ? quantityRequired : available;
  const picked = wanted < available ? wanted : available;
  return picked > 0 ? picked : 0;
}

// ---------------------------------------------------------------------------
// Typed quantities
// ---------------------------------------------------------------------------

/**
 * A typed quantity that may be ZERO, or null when it is not a usable number.
 *
 * Deliberately NOT `parseQuantity` from the operations screen, which rejects 0
 * because reporting zero good parts is meaningless. Here 0 is the most
 * important answer there is: "how many were actually picked?" answered with
 * nothing on the shelf is a short pick of 0, which the server accepts
 * (`pickQuantityBody` is `min(0)`) and the web's `ShortPickModal` offers
 * (`minValue={0}`). Reusing the positive-only parser would silently disable
 * the Mark short button for exactly the case it exists for.
 *
 * Not `Number(text)` either: that reads "0x10" as 16, "1e3" as 1000 and " " as
 * 0, none of which a kitter meant to type into a quantity field.
 */
export function parseNonNegativeQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** A scanned code matched against the offered lots, by id or by lot number. */
export function matchLot(
  lots: TrackedLot[],
  scanned: string
): TrackedLot | undefined {
  const code = scanned.trim();
  if (!code) return undefined;
  return lots.find(
    (lot) => lot.trackedEntityId === code || lot.readableId === code
  );
}
