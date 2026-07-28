import { z } from "zod";
import { zfd } from "zod-form-data";

export const documentTypes = [
  "Archive",
  "Document",
  "Presentation",
  "PDF",
  "Spreadsheet",
  "Text",
  "Image",
  "Video",
  "Audio",
  "Other"
] as const;

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline"
] as const;

export const jobStatus = [
  "Draft",
  "Planned",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled"
] as const;

export const jobOperationStatus = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused",
  "Done",
  "Canceled"
] as const;

export const pickingListStatus = [
  "Draft",
  "In Progress",
  "Completed",
  "Cancelled"
] as const;

export const pickingListLineStatus = [
  "Pending",
  "Picked",
  "Short",
  "Cancelled"
] as const;

export const pickQuantityValidator = z.object({
  pickingListLineId: z.string().min(1),
  quantity: zfd.numeric(z.number().min(0)),
  markShort: zfd.text(z.string().optional())
});

// A picking list locks once Completed or Cancelled. Reopening is ERP-only
// (requires the inventory `delete` permission), so MES must never unlock one.
export function isPickingListLocked(
  status: string | null | undefined
): boolean {
  return status === "Completed" || status === "Cancelled";
}

export const maintenanceDispatchPriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

export const maintenanceSeverity = [
  "Preventive",
  "Operator Performed",
  "Support Required",
  "OEM Required"
] as const;

export const maintenanceSource = [
  "Scheduled",
  "Reactive",
  "Non-Conformance"
] as const;

export const oeeImpact = ["Down", "Planned", "Impact", "No Impact"] as const;

export const convertEntityValidator = z.object({
  trackedEntityId: z.string(),
  newRevision: z.string(),
  quantity: z.coerce.number().positive().default(1)
});

export const stepRecordValidator = z.object({
  index: zfd.numeric(z.number()),
  jobOperationStepId: z.string(),
  value: zfd.text(z.string().optional()),
  numericValue: zfd.numeric(z.number().optional()),
  booleanValue: zfd
    .text(z.enum(["true", "false"]).transform((val) => val === "true"))
    .optional(),
  userValue: zfd.text(z.string().optional())
});

export const issueValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  jobOperationId: z.string().min(1, { message: "Job Operation is required" }),
  materialId: zfd.text(z.string().optional()),
  // When issuing an unplanned part from the shop floor (no materialId), scope the
  // newly-created jobMaterial to the step it was issued on so it shows on that step.
  jobOperationStepId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number()),
  adjustmentType: z.enum(["Set Quantity", "Positive Adjmt.", "Negative Adjmt."])
});

export const suggestionValidator = z.object({
  suggestion: z.string().min(1, { message: "Suggestion is required" }),
  emoji: z.string().default("💡"),
  attachmentPath: z.string().optional(),
  path: z.string(),
  userId: zfd.text(z.string().optional()),
  sendToCarbon: zfd
    .text(z.string().optional())
    .transform((value) => value === "true")
});

export const productionEventType = ["Setup", "Labor", "Machine"] as const;

export const productionEventAction = ["Start", "End"] as const;

export const productionEventValidator = z.object({
  id: zfd.text(z.string().optional()),
  jobOperationId: z
    .string()
    .min(1, { message: "Job Operation ID is required" }),
  timezone: zfd.text(z.string()),
  action: z.enum(productionEventAction, {
    errorMap: (issue, ctx) => ({
      message: "Action is required"
    })
  }),
  type: z.enum(productionEventType, {
    errorMap: (issue, ctx) => ({
      message: "Type is required"
    })
  }),
  workCenterId: zfd.text(z.string().optional()),
  trackedEntityId: zfd.text(z.string().optional()),
  // The 0-based unit-axis position this event is building — identical to the key
  // written to jobOperationStepRecord.index. Recorded on the tracked activity so
  // traceability can isolate this unit's step records from the operation's other
  // units. Omitted by the operation view (no unit paging).
  unitIndex: zfd.numeric(z.number().optional()),
  // Assembly clocking is single-phase: when set, starting this work type ends
  // any other open work type for the operator on this operation (so Setup and
  // Labor can never run at once). Omitted by the operation view.
  exclusive: zfd.text(z.string().optional())
});

export const finishValidator = z.object({
  jobOperationId: z.string(),
  setupProductionEventId: zfd.text(z.string().optional()),
  laborProductionEventId: zfd.text(z.string().optional()),
  machineProductionEventId: zfd.text(z.string().optional())
});

export const issueTrackedEntityValidator = z.object({
  materialId: z.string().optional(),
  jobOperationId: z.string().optional(),
  itemId: z.string().optional(),
  parentTrackedEntityId: z.string(),
  children: z.array(
    z.object({
      trackedEntityId: z.string(),
      quantity: z.number()
    })
  ),
  // Assembly view only: the step + unit the operator was on when scanning, so the
  // consume can be attributed per-unit (and per-step) even for a batch parent where
  // every unit shares one lot entity. `unitNumber` is 1-based (currentUnitIndex + 1).
  jobOperationStepId: z.string().optional(),
  unitNumber: z.number().int().positive().optional(),
  // Set when policy is BlockWithOverride and operator typed a reason.
  overrideExpired: z.boolean().optional(),
  overrideReason: z.string().optional()
});

export const baseQuantityValidator = finishValidator.extend({
  trackedEntityId: zfd.text(z.string().optional()),
  trackingType: z.enum(["Serial", "Batch", ""]).optional(),
  quantity: zfd.numeric(z.number().positive()),
  notes: zfd.text(z.string().optional())
});

export const nonScrapQuantityValidator = baseQuantityValidator;

export const scrapQuantityValidator = baseQuantityValidator.extend({
  scrapReasonId: zfd.text(z.string()),
  notes: zfd.text(z.string().optional())
});

export const triggerReworkValidator = z.object({
  jobId: z.string().min(1),
  triggeredAtJobOperationId: z.string().min(1),
  targetJobOperationId: z
    .string()
    .min(1, { message: "Target operation is required" }),
  reason: z.string().min(1, { message: "Reason is required" }),
  quantity: zfd.numeric(
    z.number().positive({ message: "Quantity must be greater than 0" })
  ),
  trackedEntityIds: zfd.text(z.string().optional()),
  // Provenance link when the rework was triggered by an inspection
  // disposition (stamped on the Rework productionQuantity row).
  inspectionId: zfd.text(z.string().optional())
});

export const maintenanceDispatchValidator = z.object({
  workCenterId: z.string().min(1, { message: "Work Center is required" }),
  priority: z.enum(maintenanceDispatchPriority, {
    errorMap: () => ({ message: "Priority is required" })
  }),
  severity: z.enum(maintenanceSeverity, {
    errorMap: () => ({ message: "Severity is required" })
  }),
  oeeImpact: z.enum(oeeImpact, {
    errorMap: () => ({ message: "OEE Impact is required" })
  }),
  suspectedFailureModeId: zfd.text(z.string().optional()),
  actualFailureModeId: zfd.text(z.string().optional()),
  content: zfd.text(z.string().optional()),
  actualStartTime: zfd.text(z.string().optional()),
  actualEndTime: zfd.text(z.string().optional())
});

export const qualityIssuePriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

export const qualityIssueValidator = z.object({
  jobOperationId: z.string().min(1, { message: "Operation is required" }),
  description: z.string().min(1, { message: "Description is required" }),
  nonConformanceTypeId: z
    .string()
    .min(1, { message: "Issue type is required" }),
  priority: z.enum(qualityIssuePriority, {
    errorMap: () => ({ message: "Priority is required" })
  }),
  trackedEntityId: zfd.text(z.string().optional())
});

export const maintenanceDispatchIssueValidator = z.object({
  maintenanceDispatchItemId: z.string().min(1, {
    message: "Maintenance Dispatch Item is required"
  }),
  quantity: zfd.numeric(z.number()),
  adjustmentType: z.enum(["Positive Adjmt.", "Negative Adjmt."])
});

export const maintenanceDispatchIssueTrackedEntityValidator = z.object({
  maintenanceDispatchItemId: z.string(),
  children: z.array(
    z.object({
      trackedEntityId: z.string(),
      quantity: z.number()
    })
  )
});

// Inspection execution (mirrors the ERP quality module's validators — the
// shared engine in @carbon/database/quality consumes these shapes).
export const inspectionSampleValidator = z.object({
  inspectionId: z.string().min(1, { message: "Inspection is required" }),
  // Optional: update an existing sample in place (the grid's "Overall result"
  // row re-toggles an anonymous non-serial column). Serial parts upsert by the
  // tracked entity instead, so they don't need it.
  sampleId: zfd.text(z.string().optional()),
  // Optional: serial parts scan a discrete tracked entity; batch / inventory /
  // non-inventory parts record pass/fail without one.
  trackedEntityId: zfd.text(z.string().optional()),
  // "Pending" registers a sample without a verdict (identify-only scan when an
  // inspection document drives per-feature measurements).
  status: z.enum(["Pending", "Passed", "Failed"], {
    errorMap: () => ({ message: "Status is required" })
  }),
  notes: zfd.text(z.string().optional())
});

// One decision surface for closing an inspection lot: the verdict carries its
// physical outcome. Accept completes the remaining lot; Reject/Partial split
// the failed set between Scrap (reason) and Rework (upstream target op) — or
// record only. Serial lots allocate per entity (two disjoint JSON id arrays);
// non-serial lots allocate by quantity. The route recomputes every bucket from
// the DB and clamps to the operation's remaining quantity — these fields are
// operator intent, not trusted arithmetic.
export const inspectionDispositionValidator = z
  .object({
    decision: z.enum(["Accept", "Reject", "Partial"], {
      errorMap: () => ({ message: "Decision is required" })
    }),
    // The job operation, for postings + redirect back to the inspection view.
    operationId: z.string().min(1, { message: "Operation is required" }),
    setupProductionEventId: zfd.text(z.string().optional()),
    laborProductionEventId: zfd.text(z.string().optional()),
    machineProductionEventId: zfd.text(z.string().optional()),
    // Serial allocation: JSON string[] of tracked entity ids per outcome.
    scrapEntityIds: zfd.text(z.string().optional()),
    reworkEntityIds: zfd.text(z.string().optional()),
    // Non-serial allocation: quantities out of the failed/remainder count.
    scrapQuantity: zfd.numeric(z.number().min(0).optional()),
    reworkQuantity: zfd.numeric(z.number().min(0).optional()),
    // Shared outcome params.
    scrapReasonId: zfd.text(z.string().optional()),
    targetOperationId: zfd.text(z.string().optional()),
    reworkReason: zfd.text(z.string().optional()),
    // NCR is optional documentation — never required for scrap or rework.
    createNcr: zfd.text(z.enum(["true", "false"]).optional()),
    nonConformanceTypeId: zfd.text(z.string().optional())
  })
  .superRefine((data, ctx) => {
    const parseIds = (json: string | undefined): string[] => {
      if (!json) return [];
      try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const scrapCount = parseIds(data.scrapEntityIds).length;
    const reworkCount = parseIds(data.reworkEntityIds).length;
    const hasScrap = scrapCount > 0 || (data.scrapQuantity ?? 0) > 0;
    const hasRework = reworkCount > 0 || (data.reworkQuantity ?? 0) > 0;
    if (hasScrap && !data.scrapReasonId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scrapReasonId"],
        message: "Scrap reason is required"
      });
    }
    if (hasRework && !data.targetOperationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetOperationId"],
        message: "Target operation is required"
      });
    }
    if (hasRework && !data.reworkReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reworkReason"],
        message: "Rework reason is required"
      });
    }
  });

// Progressive completion of passed units while the lot stays open — posts a
// Production row per passed serial sample (or one linked bulk row for
// non-serial counts) with sample-level provenance links.
export const inspectionCompletePassedValidator = z.object({
  operationId: z.string().min(1, { message: "Operation is required" }),
  setupProductionEventId: zfd.text(z.string().optional()),
  laborProductionEventId: zfd.text(z.string().optional()),
  machineProductionEventId: zfd.text(z.string().optional())
});

export const inspectionMeasurementValidator = z.object({
  inspectionId: z.string().min(1, { message: "Inspection is required" }),
  // Absent = create an anonymous sample (non-serial grid columns).
  sampleId: zfd.text(z.string().optional()),
  inspectionFeatureId: z.string().min(1, { message: "Feature is required" }),
  // Numeric string for Measurement features; empty clears the reading.
  value: zfd.text(z.string().optional()),
  // Attribute (non-numeric) features toggle pass/fail instead of a value.
  passed: zfd.text(z.enum(["true", "false"]).optional()),
  notes: zfd.text(z.string().optional())
});
