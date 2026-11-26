// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useReducer } from "react";
import { useSearchParams } from "react-router";
import { TRAVELER_PARAM } from "~/utils/path";
import {
  initialWorkUnitState,
  pickEvent,
  serialUnitSelection,
  workUnitReducer
} from "~/utils/workUnit";

/**
 * The serial unit an operation or assembly screen works on (`serialUnitSelection`).
 * `pick` is called from the click or scan that names the unit, so the unit is
 * held in the same render. The URL follows the unit with a history replace,
 * so the loader reads that unit's materials and a refresh lands on it.
 * `?scanned` (a scan of the unit's own label on another page) is read once,
 * when the screen opens, then dropped.
 */
export function useWorkUnit<
  T extends { id: string; inOperationScope?: boolean }
>({
  serial,
  isFirstOperation,
  units,
  isOpen: isIncomplete,
  isOnHold
}: {
  serial: boolean;
  isFirstOperation: boolean;
  units: T[];
  /** Still to do at this operation. */
  isOpen: (unit: T) => boolean;
  /** On hold for an open quality issue (`serialUnitSelection`). */
  isOnHold?: (unit: T) => boolean;
}) {
  // A pick of a unit on hold is a look at it, like a pick of a finished one.
  const isOpen = (unit: T) => isIncomplete(unit) && !isOnHold?.(unit);
  const { t } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlUnitId = searchParams.get("trackedEntityId");
  const scanned = searchParams.has(TRAVELER_PARAM);
  const [state, dispatch] = useReducer(workUnitReducer, null, () => {
    const unit = scanned ? units.find((u) => u.id === urlUnitId) : undefined;
    return initialWorkUnitState(
      unit ? { unitId: unit.id, isOpen: isOpen(unit) } : null
    );
  });
  const selection = serialUnitSelection({
    serial,
    isFirstOperation,
    units,
    urlUnitId,
    state,
    isOpen: isIncomplete,
    isOnHold
  });

  const target = serial ? selection.unit?.id : undefined;
  useEffect(() => {
    if (!serial || (!scanned && (!target || target === urlUnitId))) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(TRAVELER_PARAM);
        if (target) {
          next.set("trackedEntityId", target);
          next.delete("unit");
        }
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }, [serial, scanned, target, urlUnitId, setSearchParams]);

  return {
    ...selection,
    pick: (unitId: string) => {
      const event = pickEvent(units, unitId, isOpen);
      if (!event) {
        toast.error(t`This unit is not part of this operation`);
        return;
      }
      dispatch(event);
    },
    closePicker: () => dispatch({ type: "close" }),
    askForUnit: () => dispatch({ type: "ask" })
  };
}
