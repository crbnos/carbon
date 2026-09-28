import type { z } from "zod";
import { requireToolPermission } from "~/modules/shared/tool-permission.server";
import { toToolResult, validationFailure } from "~/utils/command-result";
import { ruleError } from "~/utils/supabase";
import {
  inspectionMeasurementValidator,
  inspectionSampleValidator
} from "./quality.models";
import {
  dispositionInspection as dispositionInspectionLot,
  upsertInspectionMeasurement as upsertInspectionMeasurementRow,
  upsertInspectionSample as upsertInspectionSampleRow
} from "./quality.server";

// MCP/API tools for inspection execution. The engine (`@carbon/database/quality`)
// runs in a Kysely transaction, which `quality.service.ts` cannot build (it is
// client-bundled through the `~/modules/quality` barrel), so the ERP routes call
// it through `quality.server.ts`. This companion is server-only (never
// re-exported by the barrel); `registry.server.ts` spreads it into the
// `quality` namespace and `scripts/generate-mcp.ts` publishes it.
//
// Kysely bypasses RLS, so every tool re-applies its route's gate —
// `requirePermissions({ update: "quality", role: "employee" })` on
// `x+/inspection+/$id.{sample,measurement,accept,partial}` — through
// `requireToolPermission` before touching the engine.
//
// Engine refusals ("Inspection not found", a closed lot, …) are returned as
// service rule errors so the caller reads them; the ERP routes hand the same
// messages to the browser.

const INSPECTION_GATE = { update: "quality", role: "employee" } as const;

/**
 * Record a sample on a receipt inspection lot, as the inspection screen does:
 * `status` is "Passed", "Failed" or "Pending" (identify-only, when an
 * inspection document drives per-feature measurements). Serial parts pass the
 * scanned `trackedEntityId`; pass `sampleId` to update an existing sample in
 * place. Re-derives the lot status from its samples. Returns the sample id.
 */
export async function upsertInspectionSample(
  companyId: string,
  userId: string,
  sample: z.infer<typeof inspectionSampleValidator>
) {
  await requireToolPermission(
    companyId,
    userId,
    INSPECTION_GATE,
    "record inspection samples"
  );
  const parsed = inspectionSampleValidator.safeParse(sample);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  return toToolResult(
    await upsertInspectionSampleRow({
      ...parsed.data,
      companyId,
      inspectedBy: userId
    })
  );
}

/**
 * Record one feature measurement on an inspection lot, as the measurement grid
 * does: `value` (numeric string) for a Measurement feature, `passed`
 * ("true"/"false") for an attribute feature. Without `sampleId` a new anonymous
 * sample is created. Returns the sample and measurement ids and their derived
 * statuses.
 */
export async function upsertInspectionMeasurement(
  companyId: string,
  userId: string,
  measurement: z.infer<typeof inspectionMeasurementValidator>
) {
  await requireToolPermission(
    companyId,
    userId,
    INSPECTION_GATE,
    "record inspection measurements"
  );
  const parsed = inspectionMeasurementValidator.safeParse(measurement);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  return toToolResult(
    await upsertInspectionMeasurementRow({
      ...parsed.data,
      companyId,
      userId
    })
  );
}

/**
 * Accept or mark Partial a receipt inspection lot, as the Accept / Partial
 * buttons on the inspection screen do. Receipt lots only: a Job Operation lot
 * is dispositioned with its physical outcome on the shop floor.
 *
 * Reject is not available here: the ERP reject action also writes the rejected
 * stock off and can raise a non-conformance, and that orchestration still lives
 * only in its route.
 */
export async function dispositionInspection(
  companyId: string,
  userId: string,
  args: {
    id: string;
    decision: "Accept" | "Partial";
  }
) {
  await requireToolPermission(
    companyId,
    userId,
    INSPECTION_GATE,
    "disposition inspection lots"
  );
  if (args.decision !== "Accept" && args.decision !== "Partial") {
    return {
      data: null,
      error: ruleError(
        'decision must be "Accept" or "Partial"; reject a lot from the inspection screen.'
      )
    };
  }
  return toToolResult(
    await dispositionInspectionLot({
      id: args.id,
      decision: args.decision,
      companyId,
      dispositionedBy: userId,
      // ERP verdicts carry no production posting — Receipt lots only, as the
      // accept/partial routes pass.
      requireSource: "Receipt"
    })
  );
}
