// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The work centers whose hours come from a shift: the machine side of a shift
 * change (the people side is the gated-process scoping). Follows the
 * scheduler's availability ladder (`resolveWorkCenterWindows`):
 *
 * - a lights-out (`alwaysOn`) station runs 24×7 and ignores shifts;
 * - a station linked to this shift runs it, so an added, edited or removed
 *   shift changes its hours;
 * - a station with no link to an active shift runs every shift at its
 *   location, so any shift at that location changes its hours.
 */
export function workCentersOnShift(args: {
  shift: { id: string; locationId: string | null };
  workCenters: { id: string; locationId: string | null; alwaysOn: boolean }[];
  workCenterShifts: { workCenterId: string; shiftId: string }[];
  activeShiftIds: Set<string>;
}): string[] {
  const { shift, workCenters, workCenterShifts, activeShiftIds } = args;
  const linkedToThisShift = new Set<string>();
  const linkedToActiveShift = new Set<string>();
  for (const link of workCenterShifts) {
    if (link.shiftId === shift.id) linkedToThisShift.add(link.workCenterId);
    if (activeShiftIds.has(link.shiftId)) {
      linkedToActiveShift.add(link.workCenterId);
    }
  }
  return workCenters
    .filter(
      (wc) =>
        !wc.alwaysOn &&
        (linkedToThisShift.has(wc.id) ||
          (wc.locationId !== null &&
            wc.locationId === shift.locationId &&
            !linkedToActiveShift.has(wc.id)))
    )
    .map((wc) => wc.id);
}
