// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which serial unit an operation screen works on. One decision, made during
// render, shared by the operation and assembly views (`useWorkUnit`). The
// server makes the same first / later decision (`resolveWorkUnit`).
//
// On a later operation a unit is held only when the operator picked or
// scanned it in this session (React state, set in the click or scan handler),
// or when it is the one unit left. A unit in the URL is never held by itself:
// the URL only mirrors the pick, so a refresh, a link or Back asks again. On
// the first operation units flow in order, so the unit is the URL's, or the
// next open one when it is done.
//
// A unit on hold for an open quality issue (`isOnHold`) is not open: no work
// names it, and it is never the next unit or the one left. A unit the
// operator picked stays on screen when it goes on hold, so they see why.

import { isUnitOnHold, type UnitHolds } from "./unitHold";

type UnitLike = {
  id: string;
  inOperationScope?: boolean;
  attributes?: unknown;
  status?: string | null;
};

/** The marker records the unit index, including index zero. Legacy scalar
 * attributes carry no operation marker. */
export function completedAtOperation(
  attributes: unknown,
  operationId: string
): boolean {
  return (
    attributes !== null &&
    typeof attributes === "object" &&
    Object.prototype.hasOwnProperty.call(attributes, `Operation ${operationId}`)
  );
}

/** Keep the step-record order. Completed units consume capacity. A blocked
 * serial remains visible for review and leaves its place available to a replacement. */
export function operationUnits<T extends UnitLike>(
  entities: T[],
  unitCount: number | null | undefined,
  quality?: { operationId: string; holds: UnitHolds | undefined }
): T[] {
  const inScope = entities.filter(
    (entity) => entity.inOperationScope !== false
  );
  if (!unitCount || unitCount <= 0 || inScope.length <= unitCount)
    return inScope;
  if (!quality) return inScope.slice(0, unitCount);
  const completedHere = (unit: T) =>
    completedAtOperation(unit.attributes, quality.operationId);
  let remaining = unitCount - inScope.filter(completedHere).length;
  return inScope.filter((unit) => {
    if (
      completedHere(unit) ||
      isUnitOnHold(quality.holds, unit.id) ||
      unit.status === "Consumed" ||
      unit.status === "Scrapped"
    )
      return true;
    if (remaining <= 0) return false;
    remaining--;
    return true;
  });
}

export type WorkUnitState = {
  /** The operator's pick or scan. `review`: the unit was done here when picked. */
  pick: { unitId: string; review: boolean } | null;
  /** The pick the picker was closed on; `undefined` until it is closed. */
  closedOn: string | null | undefined;
  /** Opened by hand: the Select a unit button, a scan that needs a unit. */
  asked: boolean;
};

export type WorkUnitEvent =
  | { type: "pick"; unitId: string; isOpen: boolean }
  | { type: "close" }
  | { type: "ask" };

/** The pick of `unitId`, or null when the screen does not list that unit. */
export function pickEvent<T extends UnitLike>(
  units: T[],
  unitId: string,
  isOpen: (unit: T) => boolean
): WorkUnitEvent | null {
  const unit = units.find((u) => u.id === unitId);
  return unit ? { type: "pick", unitId, isOpen: isOpen(unit) } : null;
}

/** A unit scanned on its own label before this screen opened, else nothing. */
export function initialWorkUnitState(
  scanned: { unitId: string; isOpen: boolean } | null
): WorkUnitState {
  const state: WorkUnitState = {
    pick: null,
    closedOn: undefined,
    asked: false
  };
  return scanned ? workUnitReducer(state, { type: "pick", ...scanned }) : state;
}

export function workUnitReducer(
  state: WorkUnitState,
  event: WorkUnitEvent
): WorkUnitState {
  switch (event.type) {
    case "pick":
      // Picking a finished unit is a look back, not a request for work.
      return {
        pick: { unitId: event.unitId, review: !event.isOpen },
        closedOn: event.isOpen ? state.closedOn : event.unitId,
        asked: false
      };
    case "close":
      return { ...state, closedOn: state.pick?.unitId ?? null, asked: false };
    case "ask":
      return { ...state, asked: true };
  }
}

/**
 * Whose step records the screen shows: `index`, the shown unit's record key,
 * or null for none. A later operation of a serial part with no unit on screen
 * shows no unit's records, not a default unit's.
 */
export function shownRecordIndex(
  selection: { requiresPick: boolean; unit?: unknown },
  index: number
): number | null {
  return selection.requiresPick && !selection.unit ? null : index;
}

/** The unit the screen works on, decided from the pick, the URL and the units. */
export function serialUnitSelection<T extends UnitLike>({
  serial,
  isFirstOperation,
  units,
  urlUnitId,
  state,
  isOpen: isIncomplete,
  isOnHold
}: {
  /** A serial part, not batched. */
  serial: boolean;
  isFirstOperation: boolean;
  /** `operationUnits`: the same list in both views. */
  units: T[];
  urlUnitId: string | null;
  state: WorkUnitState;
  /** Still to do at this operation. */
  isOpen: (unit: T) => boolean;
  /** On hold for an open quality issue: work on it waits. */
  isOnHold?: (unit: T) => boolean;
}) {
  const isOpen = (unit: T) => isIncomplete(unit) && !isOnHold?.(unit);
  const openUnits = units.filter(isOpen);
  const onHoldUnits = isOnHold
    ? units.filter((unit) => isIncomplete(unit) && isOnHold(unit))
    : [];
  const soleOpenUnit = openUnits.length === 1 ? openUnits[0] : undefined;
  const find = (id: string | null | undefined) =>
    id ? units.find((unit) => unit.id === id) : undefined;
  const requiresPick = serial && !isFirstOperation;

  let unit: T | undefined;
  if (serial) {
    const picked = find(state.pick?.unitId);
    if (
      picked &&
      (state.pick?.review || isOpen(picked) || isOnHold?.(picked))
    ) {
      unit = picked;
    } else if (isFirstOperation) {
      // Units flow in order: a finished one gives way to the next.
      const fromUrl = find(urlUnitId);
      unit = fromUrl && isOpen(fromUrl) ? fromUrl : (openUnits[0] ?? fromUrl);
    } else {
      unit = soleOpenUnit ?? picked;
    }
  }
  const unitIsOpen = !!unit && isOpen(unit);
  // With only units on hold left and none on screen, the picker still opens:
  // it lists them with their issue, so the operator sees why work waits.
  const canPick =
    requiresPick &&
    !unitIsOpen &&
    (openUnits.length > 0 || (!unit && onHoldUnits.length > 0));

  return {
    /** A later operation of a serial part: work waits for a held unit. */
    requiresPick,
    unit,
    unitIsOpen,
    openUnits,
    /** Still to do here, but on hold: the picker lists them to look at. */
    onHoldUnits,
    soleOpenUnit,
    /** No open unit is held, but one is left to pick (or, on hold, to look at). */
    canPick,
    /** A later operation holds no open unit: the screen asks for one. */
    noUnitHeld: requiresPick && !unitIsOpen,
    /**
     * Work that needs an open unit (complete, scrap, steps, issue, scans)
     * waits: the unit on screen is not open here, or none is held. A finished
     * unit looked back at still takes `reviewUnitId` writes.
     */
    writesBlocked: serial && !unitIsOpen,
    /** The unit a write that needs an open unit names (and a timer): only an open one. */
    workUnitId: unitIsOpen ? unit?.id : undefined,
    /**
     * The unit on screen, open or looked back at: a quality issue and an
     * unconsume name it (the server's `member` mode accepts a unit done here).
     */
    reviewUnitId: unit?.id,
    /** The picker shows: asked for, or a held unit was done and it was not closed on it. */
    pickerOpen:
      state.asked ||
      (canPick && state.closedOn !== (state.pick?.unitId ?? null))
  };
}
