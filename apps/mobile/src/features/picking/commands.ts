// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  PickingListStatusBody,
  PickQuantityBody,
  PickTrackedBody
} from "@carbon/mes-core/models";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "~/lib/api/client";
import { ApiClientError } from "~/lib/api/errors";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useInvalidatePickingList } from "./usePickingQueries";

/**
 * The three writes a kitter can make, and nothing else.
 *
 * Two rules hold for all of them, the same two the operation screen's commands
 * hold to.
 *
 * **One key per intent, minted here.** A POST without `Idempotency-Key` is
 * refused by the API, and the key is what makes a retry safe: the server
 * replays the first outcome rather than posting a second `post-picking` call
 * and a second set of `itemLedger` rows. Each call mints exactly one key, so
 * the transport may retry freely while a second TAP is a second key and a
 * second pick — which is correct, because a kitter pressing Pick twice means
 * it.
 *
 * **A failure stays on the screen.** The server's own message is what the
 * kitter reads: the list is closed, the line is tracked, there is no lineside
 * destination, `post-picking` refused it. Nothing here navigates away and
 * nothing here re-words a refusal.
 *
 * Every mutation carries `mutationKey: ["picking", listId]` so
 * `usePickingListRealtime` can tell "my own write is in flight" from "somebody
 * else changed a line" and not refetch over a pick in progress.
 */

/** The server's message, or a plain fallback — never a stack or a code. */
export function commandMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError && error.message
    ? error.message
    : fallback;
}

/** A 409 the operator may answer by confirming, as against one that is final. */
export function needsAcknowledgement(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 409 &&
    error.code === "needs_acknowledgement"
  );
}

/** A 409 the company's policy refuses outright — there is nothing to retry. */
export function isBlocked(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 409 &&
    error.code === "blocked"
  );
}

export function errorDetails(error: unknown): unknown {
  return error instanceof ApiClientError ? error.details : undefined;
}

/**
 * Set the picked quantity on an untracked line.
 *
 * `markShort` is the ShortPickModal's answer — "this is all there was" — and
 * it is what turns the line's status to Short rather than leaving it owing.
 * Picking 0 with `markShort` is a real, meaningful command (nothing was on the
 * shelf), which is why the quantity parser used by that sheet admits 0 while
 * the operation screen's does not.
 */
export function usePickQuantity(listId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidatePickingList(listId);

  return useMutation({
    mutationKey: ["picking", listId],
    mutationFn: async ({
      lineId,
      quantity,
      markShort
    }: { lineId: string } & Omit<PickQuantityBody, "pickingListLineId">) =>
      api.request<{ success: true; data: { id: string } | null }>(
        `/picking/${listId}/lines/${lineId}/quantity`,
        {
          method: "POST",
          // The route refuses a body naming a different line than the path, so
          // the two are always sent from the same `lineId`.
          body: { pickingListLineId: lineId, quantity, markShort },
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

/** Pick, or unpick, one serial/batch lot for a tracked line. */
export function usePickTracked(listId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidatePickingList(listId);

  return useMutation({
    mutationKey: ["picking", listId],
    mutationFn: async ({
      lineId,
      ...body
    }: { lineId: string } & PickTrackedBody) =>
      api.request<{ success: true; data: { id: string } | null }>(
        `/picking/${listId}/lines/${lineId}/tracked`,
        {
          method: "POST",
          body,
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

/**
 * Move the list's status.
 *
 * Asking for `Completed` can LAND on `Partial`: the server reads the company's
 * `incompletePickingListPolicy`, counts what is still unpicked and chooses the
 * terminal status itself. So the response's `status` is what the screen
 * reports, never the status that was requested.
 *
 * `acknowledged` is only ever sent after the operator confirmed a shortfall the
 * server named. It cannot talk its way past an `error` policy — that decision
 * lives in `setPickingListStatus` on the server and fails closed there — and
 * the retry is a NEW idempotency key because it is a new request.
 */
export function useSetPickingListStatus(listId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidatePickingList(listId);

  return useMutation({
    mutationKey: ["picking", listId],
    mutationFn: async (body: PickingListStatusBody) =>
      api.request<{ success: true; status: PickingListStatusBody["status"] }>(
        `/picking/${listId}/status`,
        {
          method: "POST",
          body,
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}
