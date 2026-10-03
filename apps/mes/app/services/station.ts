// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type Station = { workCenterId: string; name: string };

/**
 * What the operator's manning-board assignment means for the board.
 *
 * Two answers, not one, and the difference is the whole point:
 *
 * - `applied` — the station the board was actually NARROWED to. Web's "Your
 *   station" chip renders from this, and it must go null the moment the
 *   operator dismisses the default, or the chip comes back with a ✕ that does
 *   nothing.
 * - `mine` — the station the operator HAS today, narrowed to or not. The
 *   mobile board opens on the whole floor and offers the station as a filter
 *   to switch on, so it needs to name a station that is not applied — which
 *   `applied` is null for by definition.
 *
 * Pure so both can be pinned: `getOperationsScreen` cannot be unit-tested
 * without a database, and "web's chip reappears after a dismissal" is a
 * regression that type-checks perfectly.
 */
export function resolveStation(args: {
  /** Today's assignment, or null when the operator has none. */
  assignment: { workCenterId: string } | null | undefined;
  /** The date the operator dismissed the default for, if any. */
  overrideDate: string | null;
  /** Today at the LOCATION — what the dismissal is compared against. */
  today: string;
}): { applied: Station | null; mine: Station | null } {
  if (!args.assignment) return { applied: null, mine: null };

  const station: Station = {
    workCenterId: args.assignment.workCenterId,
    name: ""
  };
  const dismissed = args.overrideDate === args.today;
  return {
    applied: dismissed ? null : { ...station },
    mine: station
  };
}
