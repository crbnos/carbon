// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AccountLockout, Ratelimit, redis } from "@carbon/kv";

// A PIN is four digits — 10,000 values — so the verifier, not the PIN, is what
// stops a guess-every-code attack. Two layers, both in Redis (fail-open, like
// login):
// - per OPERATOR (`AccountLockout`): 5 wrong PINs in 15 min lock that operator's
//   pin-in with exponential backoff, however many terminals the guesses come from;
// - per TERMINAL (`Ratelimit`): caps how many WRONG PINs one console session can
//   submit across all operators, so spreading guesses across people does not
//   reset the budget. Only failures count — a busy shift change must not lock
//   the kiosk.
// Both are CONSUMED before the PIN is checked and given back when the request
// turns out not to be a wrong guess. Checking first and recording only on
// failure let a parallel burst all pass the check before any failure landed,
// so the limit capped nothing.
//
// Every place that checks a console PIN (pin-in, the scrap approver) shares
// these two budgets, so a guess at one counts at the other.
export const pinLockout = new AccountLockout({
  redis,
  prefix: "@carbon/console-pin",
  maxAttempts: 5,
  window: "15 m"
});

export const terminalRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "15 m"),
  prefix: "@carbon/console-pin:terminal"
});

export const GENERIC_PIN_ERROR = "Incorrect PIN";
export const LOCKED_PIN_ERROR =
  "Too many incorrect PINs. Please wait a few minutes and try again.";

export const pinLockoutKey = (companyId: string, employeeId: string) =>
  `${companyId}:${employeeId}`;

export const pinTerminalKey = (companyId: string, sessionUserId: string) =>
  `${companyId}:${sessionUserId}`;
