// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  FinishBody,
  QuantityBody,
  ReworkBody,
  ScrapBody,
  StartEventBody
} from "@carbon/mes-core/models";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "~/lib/api/client";
import { ApiClientError } from "~/lib/api/errors";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useInvalidateOperation } from "./useOperationQuery";

/**
 * Every write this screen can make.
 *
 * Two rules hold for all of them.
 *
 * **One key per intent, minted here.** A POST without `Idempotency-Key` is
 * refused by the API, and the key is what makes a retry safe: the server
 * replays the first outcome instead of posting a second production event. Each
 * mutation mints exactly one key per call, so the transport may retry freely
 * while a second TAP is a second key and a second event — which is correct,
 * because an operator pressing Start twice means it.
 *
 * **A failure never navigates.** The design rules say an operator action never
 * moves them off the operation screen, so these surface the server's own
 * message and leave the screen where it was. That message is the one the web
 * would have shown: a blocked work center, a job that is not released, a rule
 * that refused the quantity.
 */

/** The server's message, or a plain fallback — never a stack or a code. */
export function commandMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError && error.message
    ? error.message
    : fallback;
}

export function useStartEvent(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<StartEventBody, "jobOperationId">) =>
      api.request<{ ok: true; eventId: string | null }>(
        `/operations/${operationId}/events`,
        {
          method: "POST",
          body: { ...body, jobOperationId: operationId },
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

export function useEndEvent(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async ({
      eventId,
      exclusive
    }: {
      eventId: string;
      exclusive?: boolean;
    }) =>
      api.request<{ ok: true; eventId: string }>(`/events/${eventId}/end`, {
        method: "POST",
        body: { exclusive },
        idempotencyKey: newIdempotencyKey()
      }),
    onSuccess: invalidate
  });
}

export function useReportQuantity(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<QuantityBody, "jobOperationId">) =>
      api.request<{
        ok: true;
        tracking: unknown;
        finished: boolean;
      }>(`/operations/${operationId}/quantities`, {
        method: "POST",
        body: { ...body, jobOperationId: operationId },
        idempotencyKey: newIdempotencyKey()
      }),
    onSuccess: invalidate
  });
}

export function useReportScrap(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<ScrapBody, "jobOperationId">) =>
      api.request<{
        ok: true;
        scrapped: true;
        /** The replacement serial the server minted, when it did. */
        newTrackedEntityId: string | null;
      }>(`/operations/${operationId}/scrap`, {
        method: "POST",
        body: { ...body, jobOperationId: operationId },
        idempotencyKey: newIdempotencyKey()
      }),
    onSuccess: invalidate
  });
}

export function useReportRework(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<ReworkBody, "jobOperationId">) =>
      api.request<{ ok: true; reworked: true }>(
        `/operations/${operationId}/rework`,
        {
          method: "POST",
          body: { ...body, jobOperationId: operationId },
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

export function useFinishOperation(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<FinishBody, "jobOperationId">) =>
      api.request<{ ok: true; finished: true }>(
        `/operations/${operationId}/finish`,
        {
          method: "POST",
          body: { ...body, jobOperationId: operationId },
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}
