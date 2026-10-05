// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Every duration, easing and spring this app animates with.
 *
 * One file so motion is a decision made once rather than per component. The
 * failure mode it exists to prevent is the ordinary one: each screen picks
 * its own 200ms-ish fade with whatever easing was nearest, and the app ends
 * up feeling assembled rather than designed.
 *
 * **Linear is never in this list.** A constant-velocity move is the single
 * thing that reads as software rather than as an object, because nothing
 * physical starts and stops instantly. Everything here either eases or
 * springs.
 *
 * **This is a shop floor, so the numbers are short.** An operator in gloves
 * taps the same controls hundreds of times a shift; motion that is charming
 * on the first tap is a tax by the fiftieth. Nothing here runs longer than
 * 320ms except the launch screen, which happens once.
 */

/** Durations, in milliseconds. */
export const DURATION = {
  /** Press feedback and other instant acknowledgements. */
  instant: 90,
  /** The default: a thing appearing, moving or changing state. */
  quick: 180,
  /** A whole region rearranging — a list re-sorting, a layout change. */
  settle: 260,
  /** The longest an operator should ever wait on decoration. */
  slow: 320
} as const;

/**
 * Easings, as cubic-bezier control points.
 *
 * Points rather than `Easing.out(Easing.cubic)` objects for one practical
 * reason: this file is unit-tested, and importing `react-native-reanimated`
 * into the Node test runner fails on its native module. Numbers import
 * everywhere. A caller builds the curve with `Easing.bezier(...EASE.out)`.
 *
 * These are the standard cubic curves — the same ones the CSS easing
 * references name easeOutCubic / easeInOutCubic / easeInCubic.
 *
 * `out` for anything ARRIVING: fast in, settling, which reads as the thing
 * having travelled from somewhere. `inOut` for anything MOVING between two
 * on-screen positions, where both ends are visible and an abrupt start is
 * as wrong as an abrupt stop. `in` is for exits only — slow to leave, then
 * gone.
 */
export const EASE = {
  out: [0.33, 1, 0.68, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.32, 0, 0.67, 0]
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * Springs, in the three grades the reference talks about.
 *
 * A spring is described by where it ends, not how long it takes, which is
 * what makes it the right tool for anything a finger drives: interrupt it
 * half way and it resolves from where it actually is rather than jumping.
 *
 * `bouncy` is deliberately the only one that overshoots, and is reserved
 * for moments that happen once (a unit completing). Overshoot on a control
 * pressed all shift is the thing that stops being charming.
 *
 * Whether a spring overshoots is arithmetic, not taste: it does when
 * `damping < 2·sqrt(stiffness·mass)`. The first version of these numbers had
 * all three under that line, so "gentle" and "snappy" would both have
 * bounced — the test below is what caught it, and is why it exists.
 */
export const SPRING = {
  /** Settles with no overshoot. Sheets, layout moves. */
  gentle: { damping: 28, stiffness: 180, mass: 1 },
  /** Fast and tight, still no overshoot. Press feedback. */
  snappy: { damping: 32, stiffness: 320, mass: 0.7 },
  /** Overshoots once. Completion moments only. */
  bouncy: { damping: 11, stiffness: 220, mass: 0.9 }
} as const;

/**
 * How far a control shrinks when pressed.
 *
 * Scaled by the control's own size: a 48pt button taken to 0.96 moves its
 * edge about 1pt, which is felt rather than seen, while the same factor on
 * a 320pt card is a 6pt lurch. So the SHIFT is fixed and the factor is
 * derived from it — every control's edge moves the same distance whatever
 * it is.
 */
export const PRESS_EDGE_SHIFT = 1.5;

export function pressScale(size: number) {
  if (!Number.isFinite(size) || size <= 0) return 1;
  // Two edges move, so the width loses twice the shift.
  const scale = (size - PRESS_EDGE_SHIFT * 2) / size;
  // A floor, so a very small control is not crushed by a fixed shift.
  return Math.min(1, Math.max(0.9, scale));
}
