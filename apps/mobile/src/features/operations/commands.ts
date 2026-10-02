// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  FinishBody,
  IssueMaterialBody,
  IssueTrackedBody,
  PrintBody,
  QualityIssueBody,
  QuantityBody,
  ReworkBody,
  ScrapBody,
  StartEventBody,
  StepRecordBody,
  UnconsumeBody
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

// ---------------------------------------------------------------------------
// Materials, instructions, notes
// ---------------------------------------------------------------------------

export function useIssueMaterial(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<IssueMaterialBody, "jobOperationId">) =>
      api.request<{ ok: true }>(`/operations/${operationId}/materials/issue`, {
        method: "POST",
        body: { ...body, jobOperationId: operationId },
        idempotencyKey: newIdempotencyKey()
      }),
    onSuccess: invalidate
  });
}

export function useIssueTracked(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<IssueTrackedBody, "jobOperationId">) =>
      api.request<{ ok: true }>(
        `/operations/${operationId}/materials/issue-tracked`,
        {
          method: "POST",
          body: { ...body, jobOperationId: operationId },
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

export function useUnconsume(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<UnconsumeBody, "jobOperationId">) =>
      api.request<{ ok: true }>(
        `/operations/${operationId}/materials/unconsume`,
        {
          method: "POST",
          body: { ...body, jobOperationId: operationId },
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

export function useRecordStep(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: StepRecordBody) =>
      api.request<{ ok: true; id?: string }>(
        `/operations/${operationId}/step-records`,
        {
          method: "POST",
          body,
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

export function useDeleteStepRecord(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    // A POST, not a DELETE, matching the web route it mirrors — so the
    // idempotency window applies and an operator on a dropped connection
    // cannot delete a second record by retrying.
    mutationFn: async (recordId: string) =>
      api.request<{ ok: true }>(`/step-records/${recordId}/delete`, {
        method: "POST",
        idempotencyKey: newIdempotencyKey()
      }),
    onSuccess: invalidate
  });
}

export function useAddNote(operationId: string) {
  const { api } = useAuth();

  return useMutation({
    mutationFn: async (note: string) =>
      api.request<{ ok: true; id?: string }>(
        `/operations/${operationId}/notes`,
        {
          method: "POST",
          body: { note },
          idempotencyKey: newIdempotencyKey()
        }
      )
  });
}

export function useRaiseQualityIssue(operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateOperation(operationId);

  return useMutation({
    mutationFn: async (body: Omit<QualityIssueBody, "jobOperationId">) =>
      api.request<{ ok: true; id?: string; readableId?: string }>(
        "/quality-issues",
        {
          method: "POST",
          body: { ...body, jobOperationId: operationId },
          idempotencyKey: newIdempotencyKey()
        }
      ),
    onSuccess: invalidate
  });
}

/**
 * Queue a label print.
 *
 * Nothing is printed from the device: mobile operating systems make raw
 * network and Bluetooth printing hard, and the server already knows the
 * printers. This reaches the same printers through the same Inngest event the
 * web's print button fires.
 */
export function usePrintLabel() {
  const { api } = useAuth();

  return useMutation({
    mutationFn: async (body: PrintBody) =>
      api.request<{ ok: true }>("/print", {
        method: "POST",
        body,
        idempotencyKey: newIdempotencyKey()
      })
  });
}
