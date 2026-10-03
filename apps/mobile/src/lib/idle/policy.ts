// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * What an idle tablet should do.
 *
 * Two different situations wear the same clothes. A SHARED terminal with an
 * operator pinned in must pin them out — otherwise the next person's work is
 * credited to whoever walked away, which is the whole reason operator
 * attribution exists. A tablet in a controlled environment must sign out
 * entirely, because the requirement there is about the SESSION, not about
 * attribution.
 *
 * An ordinary personal device does neither. Signing an operator out of their
 * own phone because they took a call is hostile, and `idleLockMs` is a policy
 * about shared and controlled hardware.
 */
export type IdleAction = "none" | "pin_out" | "sign_out";

export function idleAction(args: {
  /** `me.instance.idleLockMs`. Zero or missing means no idle policy. */
  idleLockMs: number | null | undefined;
  controlledEnvironment: boolean;
  /** True when an operator is pinned in on a shared terminal. */
  hasOperator: boolean;
}): IdleAction {
  const limit = args.idleLockMs ?? 0;
  if (!Number.isFinite(limit) || limit <= 0) return "none";
  // Pinning out is the lighter action and the more common one, so it wins when
  // both could apply: the terminal stays signed in and ready for the next
  // operator, which is what a shared tablet is for.
  if (args.hasOperator) return "pin_out";
  if (args.controlledEnvironment) return "sign_out";
  return "none";
}

/** Whether enough time has passed, given the last interaction. */
export function isIdle(args: {
  lastActivityMs: number;
  nowMs: number;
  idleLockMs: number | null | undefined;
}) {
  const limit = args.idleLockMs ?? 0;
  if (!Number.isFinite(limit) || limit <= 0) return false;
  // A clock that went backwards (an NTP correction, a user changing the date)
  // must not read as "idle for a negative time" and lock instantly.
  const elapsed = args.nowMs - args.lastActivityMs;
  return elapsed >= limit;
}
