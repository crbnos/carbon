// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  inspectionCompletePassedResult,
  inspectionDispositionResult,
  inspectionGaugeResult,
  inspectionMeasurementResult,
  inspectionSampleResult
} from "@carbon/mes-core";
import type {
  InspectionCompletePassedBody,
  InspectionDispositionBody,
  InspectionGaugeBody,
  InspectionMeasurementBody,
  InspectionSampleBody
} from "@carbon/mes-core/models";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "~/lib/api/client";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useInvalidateInspection } from "./useInspectionQuery";

/**
 * The five inspection writes.
 *
 * **Which ones invalidate, and why it is not all of them.** A measurement and
 * a gauge are per-cell: they return the cell's own new status, the screen keeps
 * it as a local patch, and nothing else on the screen changed — so a refetch
 * would cost a round trip per keystroke-commit and would re-seed the grid
 * under the inspector's hands. The lot-level writes (a scanned unit, a
 * completion, a disposition) DO invalidate, because the server derives
 * quantities and statuses from rows this app does not hold.
 *
 * **One key per intent.** A POST without `Idempotency-Key` is refused. Each
 * call mints exactly one, so the transport may retry freely while a second TAP
 * is a second key and a second write — which is correct, because an inspector
 * pressing Accept twice means it.
 *
 * On a DISPOSITION that key matters more than anywhere else in the app: the
 * command closes the lot first and posts afterwards, so a failure past the
 * close comes back 5xx and the server replays that 5xx rather than re-running
 * a half-applied disposition. Retrying must therefore be the inspector's own
 * decision, never the transport's.
 */
export function useRecordMeasurement(inspectionId: string) {
  const { api } = useAuth();

  return useMutation({
    mutationFn: (body: Omit<InspectionMeasurementBody, "inspectionId">) =>
      api.request(`/inspections/${inspectionId}/measurement`, {
        method: "POST",
        body: { ...body, inspectionId },
        idempotencyKey: newIdempotencyKey(),
        schema: inspectionMeasurementResult
      })
  });
}

export function useSetGauge(inspectionId: string) {
  const { api } = useAuth();

  return useMutation({
    mutationFn: (body: Omit<InspectionGaugeBody, "inspectionId">) =>
      api.request(`/inspections/${inspectionId}/gauge`, {
        method: "POST",
        body: { ...body, inspectionId },
        idempotencyKey: newIdempotencyKey(),
        schema: inspectionGaugeResult
      })
  });
}

/**
 * Register a unit, or set its verdict.
 *
 * Two jobs on purpose, as on the web: `Pending` is the identify-only scan a
 * serial lot makes before any characteristic is measured, and `Passed`/`Failed`
 * is the overall-result cell of a lot with no characteristics.
 */
export function useRecordSample(
  inspectionId: string,
  operationId: string,
  options?: { invalidate?: boolean }
) {
  const { api } = useAuth();
  const invalidate = useInvalidateInspection(operationId);
  const shouldInvalidate = options?.invalidate ?? true;

  return useMutation({
    mutationFn: (body: Omit<InspectionSampleBody, "inspectionId">) =>
      api.request(`/inspections/${inspectionId}/sample`, {
        method: "POST",
        body: { ...body, inspectionId },
        idempotencyKey: newIdempotencyKey(),
        schema: inspectionSampleResult
      }),
    onSuccess: shouldInvalidate ? invalidate : undefined
  });
}

export function useCompletePassed(inspectionId: string, operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateInspection(operationId);

  return useMutation({
    mutationFn: (
      body: Omit<InspectionCompletePassedBody, "inspectionId" | "operationId">
    ) =>
      api.request(`/inspections/${inspectionId}/complete-passed`, {
        method: "POST",
        body: { ...body, inspectionId, operationId },
        idempotencyKey: newIdempotencyKey(),
        schema: inspectionCompletePassedResult
      }),
    onSuccess: invalidate
  });
}

export function useDisposition(inspectionId: string, operationId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateInspection(operationId);

  return useMutation({
    mutationFn: (
      body: Omit<InspectionDispositionBody, "inspectionId" | "operationId">
    ) =>
      api.request(`/inspections/${inspectionId}/disposition`, {
        method: "POST",
        body: { ...body, inspectionId, operationId },
        idempotencyKey: newIdempotencyKey(),
        schema: inspectionDispositionResult
      }),
    onSuccess: invalidate
  });
}
