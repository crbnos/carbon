// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiUserDeps } from "@carbon/auth/api-user.server";
import { logAuthEvent } from "@carbon/auth/auth-events.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ConsolePinIn } from "@carbon/auth/console-pin.server";
import { revalidateConsolePinIn } from "@carbon/auth/console-pin.server";
import { verifyOperatorToken } from "@carbon/auth/console-token.server";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  isConsoleModeEnabledForCompany,
  verifyEmployeePin
} from "@carbon/ee/console.server";
import { AccountLockout, Ratelimit, redis } from "@carbon/kv";

/**
 * The shared-terminal (console) commands, extracted from
 * `x+/console.pin-in.tsx` so the web kiosk and the mobile API verify a PIN
 * through ONE piece of code. A credential check that exists twice is a
 * credential check that will drift.
 *
 * Nothing here logs a PIN, and nothing returns one. The only values that leave
 * this file are the operator's own id, display name and avatar — what the web
 * already writes into the signed pin-in cookie.
 */

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
// These are the SAME Redis buckets and the same prefixes the web kiosk used
// before the extraction, keyed on `companyId:userId` and
// `companyId:sessionUserId` rather than on an IP — so, unlike the sign-in
// buckets in `api+/v1+/lib/ratelimit.server.ts`, a plant whose tablets all
// leave through one NAT address shares no budget. Reaching the API instead of
// the web form must not hand an attacker a fresh allowance, which is why there
// is no second bucket for the mobile path.
const pinLockout = new AccountLockout({
  redis,
  prefix: "@carbon/console-pin",
  maxAttempts: 5,
  window: "15 m"
});

const terminalRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "15 m"),
  prefix: "@carbon/console-pin:terminal"
});

export const GENERIC_PIN_ERROR = "Incorrect PIN";
export const LOCKED_PIN_ERROR =
  "Too many incorrect PINs. Please wait a few minutes and try again.";

export type PinInFailure = {
  /** The status the WEB route answers with; the API reuses it. */
  status: 400 | 403 | 429;
  code: "rate_limited" | "locked" | "invalid_pin" | "forbidden";
  message: string;
};

export type PinInResult =
  | { ok: true; operator: ConsolePinIn }
  | { ok: false; failure: PinInFailure };

/**
 * Verify an operator's console PIN at a terminal and, on success, return the
 * pin-in claim to carry — the web puts it in a signed cookie, the API signs it
 * into an operator token. The caller decides the carrier; this decides WHO.
 *
 * `sessionUserId` is the terminal's own signed-in account, never a pinned
 * operator: both the rate-limit budget and the claim's binding belong to the
 * terminal session, so an already-pinned-in tablet handing over to the next
 * operator spends the same budget and mints a claim bound to the same session.
 */
export async function pinInOperator({
  companyId,
  sessionUserId,
  userId,
  pin,
  ip,
  db
}: {
  companyId: string;
  sessionUserId: string;
  userId: string;
  pin: string;
  ip?: string;
  db: Kysely<KyselyDatabase>;
}): Promise<PinInResult> {
  const lockoutKey = `${companyId}:${userId}`;
  const terminalKey = `${companyId}:${sessionUserId}`;

  // The Lua script counts and refuses in one step, so of N concurrent requests
  // at most the remaining budget get past here. Redis down → fails open, like
  // login.
  const terminal = await terminalRatelimit.limit(terminalKey);
  if (!terminal.success) {
    logAuthEvent("login_rate_limited", {
      userId: sessionUserId,
      companyId,
      ip,
      reason: "console pin-in terminal rate limit"
    });
    return {
      ok: false,
      failure: { status: 429, code: "rate_limited", message: LOCKED_PIN_ERROR }
    };
  }

  const serviceRole = getCarbonServiceRole();

  // `employees` only lists users whose `user.active` is true; `employee.active`
  // is false once the person is deactivated in this company.
  const employee = await serviceRole
    .from("employees")
    .select("id, name, avatarUrl")
    .eq("id", userId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  if (employee.error || !employee.data) {
    // Not a PIN guess: give the terminal's attempt back.
    await terminalRatelimit.refund(terminalKey);
    return {
      ok: false,
      failure: {
        status: 400,
        code: "forbidden",
        message: "Employee not found in this company"
      }
    };
  }

  // Counts this attempt against the operator. Same atomic window, so a burst
  // gets at most `maxAttempts` PIN checks; the one after engages the lock.
  const attempt = await pinLockout.recordFailure(lockoutKey);
  if (attempt.locked) {
    await terminalRatelimit.refund(terminalKey);
    logAuthEvent("login_locked", {
      userId,
      companyId,
      ip,
      reason: "console pin-in locked",
      retryAfterSeconds: attempt.retryAfterSeconds,
      terminalUserId: sessionUserId
    });
    return {
      ok: false,
      failure: { status: 429, code: "locked", message: LOCKED_PIN_ERROR }
    };
  }

  // PINs are bcrypt hashes in `employeePin`, which no API role can read — the
  // check runs in the database over the server's direct connection.
  const pinCheck = await verifyEmployeePin(db, {
    employeeId: userId,
    companyId,
    pin
  });

  if (!pinCheck.hasPin) {
    // Nothing to guess: give both attempts back.
    await Promise.all([
      pinLockout.reset(lockoutKey),
      terminalRatelimit.refund(terminalKey)
    ]);
    return {
      ok: false,
      failure: {
        status: 400,
        code: "forbidden",
        message: "No PIN set. Ask an admin to set a console PIN for you."
      }
    };
  }

  if (!pinCheck.valid) {
    // Both attempts were already counted above; a wrong PIN keeps them.
    // The message says only that the PIN was wrong — never whether some OTHER
    // employee would have accepted it. The request names the operator, so the
    // only thing this answer reveals is valid-or-not for that one person.
    logAuthEvent("login_failed", {
      userId,
      companyId,
      ip,
      reason: "console pin-in: incorrect PIN",
      terminalUserId: sessionUserId
    });
    return {
      ok: false,
      failure: {
        status: 400,
        code: "invalid_pin",
        message: GENERIC_PIN_ERROR
      }
    };
  }

  // A correct PIN counts against neither budget.
  await Promise.all([
    pinLockout.reset(lockoutKey),
    terminalRatelimit.refund(terminalKey)
  ]);
  logAuthEvent("login_success", {
    userId,
    companyId,
    ip,
    method: "console-pin",
    terminalUserId: sessionUserId
  });

  return {
    ok: true,
    operator: {
      userId,
      // From the database, never the request: the claim is signed, so what it
      // says about the operator must be what we looked up.
      name: employee.data.name ?? "",
      avatarUrl: employee.data.avatarUrl ?? null,
      pinnedAt: Date.now()
    }
  };
}

/**
 * The operator hook `requireApiUser` runs on every `/api/v1` request that
 * carries `x-carbon-operator`.
 *
 * It is the default hook from `@carbon/auth` plus the one check that package
 * cannot make: the commercial console ENTITLEMENT
 * (`isConsoleModeEnabledForCompany`, `@carbon/ee/console.server`), because
 * `@carbon/auth` importing `@carbon/ee` would be a cycle. The flag outlives a
 * lapsed plan, so asking only `companySettings.consoleEnabled` would keep
 * attributing work to pinned operators after the entitlement went away.
 *
 * `null` from that call means the entitlement could not be READ, and a
 * transient read error is not a company switching console mode off — tearing a
 * live pin-in down on it would pin out every operator in the plant mid-shift.
 * So the tear-down direction accepts anything but a definite `false`, which is
 * the contract `@carbon/ee/console.server` documents. The MINT direction is the
 * strict one: `POST /console/terminal` and `POST /console/pin-in` both refuse
 * anything that is not a definite `true`, so a company with no entitlement
 * never obtains a token to re-validate in the first place.
 */
export const apiOperatorDeps: NonNullable<ApiUserDeps["operator"]> = {
  verify: verifyOperatorToken,
  revalidate: async (operator) => {
    if (!(await revalidateConsolePinIn(operator))) return false;
    const entitled = await isConsoleModeEnabledForCompany(
      getCarbonServiceRole(),
      operator.companyId
    );
    return entitled !== false;
  }
};
