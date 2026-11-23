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

type UnitLike = { id: string; inOperationScope?: boolean };

/** The units an operation works, in axis order: those in its scope, capped to its quantity. */
export function operationUnits<T extends UnitLike>(
  entities: T[],
  unitCount: number | null | undefined
): T[] {
  const inScope = entities.filter(
    (entity) => entity.inOperationScope !== false
  );
  return unitCount && unitCount > 0 ? inScope.slice(0, unitCount) : inScope;
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
  isOpen
}: {
  /** A serial part, not batched. */
  serial: boolean;
  isFirstOperation: boolean;
  /** `operationUnits`: the same list in both views. */
  units: T[];
  urlUnitId: string | null;
  state: WorkUnitState;
  isOpen: (unit: T) => boolean;
}) {
  const openUnits = units.filter(isOpen);
  const soleOpenUnit = openUnits.length === 1 ? openUnits[0] : undefined;
  const find = (id: string | null | undefined) =>
    id ? units.find((unit) => unit.id === id) : undefined;
  const requiresPick = serial && !isFirstOperation;

  let unit: T | undefined;
  if (serial) {
    const picked = find(state.pick?.unitId);
    if (picked && (state.pick?.review || isOpen(picked))) {
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
  const canPick = requiresPick && !unitIsOpen && openUnits.length > 0;

  return {
    /** A later operation of a serial part: work waits for a held unit. */
    requiresPick,
    unit,
    unitIsOpen,
    openUnits,
    soleOpenUnit,
    /** No open unit is held, but one is left to pick. */
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
