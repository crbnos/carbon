// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ClockOutBody } from "@carbon/mes-core/models";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "~/lib/api/client";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useInvalidateTimecard } from "./useTimecardQuery";

/**
 * The three writes the time card can make, each running the same server
 * command web MES runs: `clockInCommand`, `clockOutCommand` and `endShift` in
 * `apps/mes/app/services/commands.timecard.server.ts`. Nothing here writes a
 * `timeCardEntry` row itself.
 *
 * **One idempotency key per intent, minted here.** A POST without
 * `Idempotency-Key` is refused by the API, and the key is what makes a
 * transport retry safe: a retried clock-in replays the first outcome instead
 * of coming back as "Already clocked in", which an operator would read as
 * their tap having failed. A second TAP is a second key, which is correct —
 * somebody pressing Clock out twice means it, and the server's second answer
 * is the honest "you are not clocked in".
 *
 * **A failure never navigates.** Each caller catches, refetches through
 * `onSettled` and shows the SERVER's own message. A 409 from any of these
 * means the state moved under the operator — already clocked in, or somebody
 * else clocked them out — and the sentence the server wrote is the one they
 * need, not a summary of it.
 */

/**
 * `commandMessage` is deliberately the operations feature's copy rather than a
 * second one: it is the single place that decides a failure shows the server's
 * words, and two copies of that decision is how one of them ends up printing a
 * stack trace at a machine.
 */
export { commandMessage } from "~/features/operations/commands";

export function useClockIn() {
  const { api } = useAuth();
  const invalidate = useInvalidateTimecard();

  return useMutation({
    mutationFn: () =>
      api.request<{ success: true }>("/timecard/clock-in", {
        method: "POST",
        idempotencyKey: newIdempotencyKey()
      }),
    // `onSettled`, not `onSuccess`: a 409 means the server already has an open
    // entry, and the screen must then show the state the server is in rather
    // than the one it was showing when the operator tapped.
    onSettled: invalidate
  });
}

export function useClockOut() {
  const { api } = useAuth();
  const invalidate = useInvalidateTimecard();

  return useMutation({
    mutationFn: (body: ClockOutBody = {}) =>
      api.request<{ success: true }>("/timecard/clock-out", {
        method: "POST",
        body,
        idempotencyKey: newIdempotencyKey()
      }),
    onSettled: invalidate
  });
}

export type EndShiftResponse = {
  ok: true;
  /** The shared-terminal pin-in ended with the shift. */
  endedConsole: boolean;
};

/**
 * End the shift: close every open production event, then clock out when the
 * company runs time cards.
 *
 * `endedConsole` is the one field here with a consequence beyond the screen.
 * The web route turns it into a `clearConsolePinIn` `Set-Cookie`; this app has
 * no cookie, so it drops the in-memory operator token instead. Leaving a stale
 * token behind would attribute the NEXT person's production events to the
 * operator who just went home — which is the one failure on a shared tablet
 * that cannot be corrected afterwards, because the rows look legitimate.
 *
 * The token is dropped unless the server said `endedConsole: false`
 * explicitly. The only case the server reports false is "there was no pinned
 * operator", where the token is already null and dropping it is a no-op — so
 * reading a missing or unexpected field as "drop it" errs toward the safe side
 * rather than toward somebody else's name on the work.
 */
export function useEndShift() {
  const { api, setOperatorToken } = useAuth();
  const invalidate = useInvalidateTimecard();

  return useMutation({
    mutationFn: () =>
      api.request<EndShiftResponse>("/timecard/end-shift", {
        method: "POST",
        idempotencyKey: newIdempotencyKey()
      }),
    onSuccess: (result) => {
      if (result?.endedConsole !== false) setOperatorToken(null);
    },
    onSettled: invalidate
  });
}
