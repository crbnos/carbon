import { assertIsPost } from "@carbon/auth";
import { logAuthEvent, requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setConsolePinIn } from "@carbon/auth/console-pin.server";
import { verifyEmployeePin } from "@carbon/ee/console.server";
import { AccountLockout, Ratelimit, redis } from "@carbon/kv";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { userContext } from "~/context";
import { getDatabaseClient } from "~/services/database.server";

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

const GENERIC_PIN_ERROR = "Incorrect PIN";
const LOCKED_PIN_ERROR =
  "Too many incorrect PINs. Please wait a few minutes and try again.";

export async function action({ request, context }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, sessionUserId, consoleMode } = await requirePermissions(
    request,
    {}
  );

  // `userMiddleware` already asked the console gate (flag AND entitlement) for
  // this console session; `null` there means it could not tell, and pinning in
  // on an unknown answer is refused.
  if (!consoleMode || context.get(userContext)?.consoleEnabled !== true) {
    return data({ error: "Console mode is not enabled" }, { status: 403 });
  }

  const formData = await request.formData();
  const userId = formData.get("userId");
  const pin = formData.get("pin");

  if (typeof userId !== "string" || !userId) {
    return data({ error: "userId is required" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for") ?? undefined;
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
    return data({ error: LOCKED_PIN_ERROR }, { status: 429 });
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
    return data(
      { error: "Employee not found in this company" },
      { status: 400 }
    );
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
    return data({ error: LOCKED_PIN_ERROR }, { status: 429 });
  }

  // PINs are bcrypt hashes in `employeePin`, which no API role can read — the
  // check runs in the database over the server's direct connection.
  const pinCheck = await verifyEmployeePin(getDatabaseClient(), {
    employeeId: userId,
    companyId,
    pin: typeof pin === "string" ? pin : ""
  });

  if (!pinCheck.hasPin) {
    // Nothing to guess: give both attempts back.
    await Promise.all([
      pinLockout.reset(lockoutKey),
      terminalRatelimit.refund(terminalKey)
    ]);
    return data(
      {
        error: "No PIN set. Ask an admin to set a console PIN for you."
      },
      { status: 400 }
    );
  }

  if (!pinCheck.valid) {
    // Both attempts were already counted above; a wrong PIN keeps them.
    logAuthEvent("login_failed", {
      userId,
      companyId,
      ip,
      reason: "console pin-in: incorrect PIN",
      terminalUserId: sessionUserId
    });
    return data({ error: GENERIC_PIN_ERROR }, { status: 400 });
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

  // Return data (not a redirect) so the caller's fetcher revalidates the shell
  // loader — the `_layout` shouldRevalidate has an explicit case for this
  // action, and a redirect would drop the form context it matches on.
  return data(
    { success: true },
    {
      headers: {
        "Set-Cookie": await setConsolePinIn(companyId, sessionUserId, {
          userId,
          // From the database, never the form: the cookie is signed, so what it
          // says about the operator must be what we looked up.
          name: employee.data.name ?? "",
          avatarUrl: employee.data.avatarUrl ?? null,
          pinnedAt: Date.now()
        })
      }
    }
  );
}
