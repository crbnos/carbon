// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { endProductionEvents } from "~/services/operations.service";
import { clockIn, clockOut } from "~/services/people.service";
import type { CommandResult } from "./api-result.server";
import { failed, ok } from "./api-result.server";

/**
 * Clock in, clock out and end shift, lifted out of `api+/timecard.ts` (the
 * route the `TimeCardButton` posts to — it is the entry point the UI already
 * uses, NOT `x+/timecard.tsx`) and `x+/end-shift.tsx`.
 *
 * `x+/timecard.tsx`'s `updateEntry` / `deleteEntry` intents stay web-only in
 * v1 and are deliberately not here.
 *
 * `endShift` reports whether a console operator was ended as `endedConsole`
 * instead of touching a cookie: the web route owns the `clearConsolePinIn`
 * `Set-Cookie`, and the app drops its operator token on the same signal.
 */

const log = getLogger("mes");

export type TimecardCommandContext = {
  companyId: string;
  /** Whose time card this is — already the effective user on both paths. */
  userId: string;
};

export async function clockInCommand(
  client: SupabaseClient<Database>,
  ctx: TimecardCommandContext
): Promise<CommandResult<null>> {
  const result = await clockIn(client, {
    employeeId: ctx.userId,
    companyId: ctx.companyId,
    createdBy: ctx.userId
  });

  if (result.error) {
    // `conflict`: the only refusal the service makes is "Already clocked in",
    // which is a state the operator reads and acts on, not a server fault.
    return failed({ kind: "conflict", message: result.error.message });
  }

  return ok(null);
}

export type ClockOutArgs = {
  /** The optional shift note the web route reads from the form. */
  note?: string;
};

export async function clockOutCommand(
  client: SupabaseClient<Database>,
  ctx: TimecardCommandContext,
  args: ClockOutArgs = {}
): Promise<CommandResult<null>> {
  const result = await clockOut(client, {
    employeeId: ctx.userId,
    companyId: ctx.companyId,
    updatedBy: ctx.userId,
    note: args.note
  });

  if (result.error) {
    return failed({ kind: "conflict", message: result.error.message });
  }

  return ok(null);
}

export type EndShiftContext = TimecardCommandContext & {
  /** A shared terminal: the operator is pinned in and must be pinned out. */
  consoleMode: boolean;
};

export type EndShiftResult = {
  /** The caller owes a pin-out: the web a `Set-Cookie`, the app a token drop. */
  endedConsole: boolean;
};

/**
 * End every open production event for the operator, then clock them out when
 * the company runs time cards.
 *
 * Two clients, as the route had: `client` is the RLS-scoped one that closes the
 * production events, `serviceRole` reads `companySettings` and closes the open
 * `timeCardEntry` (a shop-floor user cannot update that row as themselves).
 *
 * A failed clock-out is logged and swallowed — the shift already ended, and
 * failing the response now would leave the operator unable to walk away.
 */
export async function endShift(
  client: SupabaseClient<Database>,
  serviceRole: SupabaseClient<Database>,
  ctx: EndShiftContext
): Promise<CommandResult<EndShiftResult>> {
  const { companyId, userId, consoleMode } = ctx;

  const updates = await endProductionEvents(client, {
    companyId,
    employeeId: userId,
    endTime: datetime.timestamp()
  });

  if (updates.error) {
    return failed({ kind: "error", message: updates.error.message });
  }

  // Clock out the operator if time card is enabled
  const settings = await serviceRole
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();

  if ((settings.data as any)?.timeCardEnabled) {
    const clockOutResult = await serviceRole
      .from("timeCardEntry")
      .update({
        clockOut: datetime.timestamp(),
        updatedBy: userId
      } as any)
      .eq("employeeId", userId)
      .eq("companyId", companyId)
      .is("clockOut", null);

    if (clockOutResult.error) {
      log.error("Failed to clock out on end shift", {
        error: clockOutResult.error
      });
    }
  }

  // In console mode, pin out the operator after ending their shift
  return ok({ endedConsole: consoleMode });
}
