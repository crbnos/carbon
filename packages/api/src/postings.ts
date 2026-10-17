// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The inputs of the postings MES calls, and the results it reads. Plain zod
// and types, so MES can type its calls without importing the ERP; the ERP
// validates with the same schemas.

import { round } from "@carbon/utils";
import { z } from "zod";

/** Each `type` adds its own fields (`newTrackedEntityId`, `readableId`, …). */
export type IssueResult = { success: boolean; message?: string } & Record<
  string,
  unknown
>;

export const issueInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("convertEntity"),
    trackedEntityId: z.string(),
    newRevision: z.string(),
    quantity: z.number().positive().default(1)
  }),
  z.object({
    type: z.literal("jobCompleteMakeToOrder"),
    jobId: z.string(),
    quantityComplete: z.number()
  }),
  z.object({
    type: z.literal("jobOperation"),
    quantity: z.number(),
    id: z.string()
  }),
  z.object({
    type: z.literal("jobOperationBatchComplete"),
    trackedEntityId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
    // Provenance links for inspection-driven completions. The partial UNIQUE
    // index on productionQuantity.inspectionSampleId makes a re-post of the
    // same verdict fail instead of double-counting.
    inspectionId: z.string().optional(),
    inspectionSampleId: z.string().optional()
  }),
  z.object({
    type: z.literal("jobOperationBatchOutput"),
    jobOperationId: z.string(),
    trackedEntityId: z.string(),
    quantity: z.number(),
    readableId: z.string().optional().nullable()
  }),
  z.object({
    type: z.literal("jobOperationSerialComplete"),
    trackedEntityId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
    inspectionId: z.string().optional(),
    inspectionSampleId: z.string().optional()
  }),
  z.object({
    type: z.literal("jobOperationScrap"),
    jobOperationId: z.string(),
    quantity: z.number().positive(),
    scrapReasonId: z.string(),
    trackedEntityId: z.string().optional(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional()
  }),
  z.object({
    type: z.literal("partToOperation"),
    id: z.string(),
    itemId: z.string(),
    quantity: z.number(),
    adjustmentType: z.enum([
      "Set Quantity",
      "Positive Adjmt.",
      "Negative Adjmt."
    ]),
    materialId: z.string().optional(),
    // Assembly view: when issuing an unplanned part (no materialId), scope the new
    // jobMaterial to this step so it surfaces on that step in the operator view.
    jobOperationStepId: z.string().optional()
  }),
  z.object({
    type: z.literal("scrapTrackedEntity"),
    trackedEntityId: z.string(),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    scrapReasonId: z.string(),
    makeReplacement: z.boolean().optional()
  }),
  z.object({
    type: z.literal("mergeTrackedEntities"),
    trackedEntityIds: z.array(z.string()).min(2),
    readableId: z.string().optional().nullable()
  }),
  z.object({
    type: z.literal("trackedEntitiesToBatch"),
    batchId: z.string(),
    itemId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    ),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional()
  }),
  z.object({
    type: z.literal("trackedEntitiesToOperation"),
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
    // Assembly view: the step + 1-based unit the operator was on, stamped onto the
    // Consume activity so issued quantities can be attributed per-unit/per-step even
    // for a batch parent (all units share one lot entity).
    jobOperationStepId: z.string().optional(),
    unitNumber: z.number().int().positive().optional(),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional()
  }),
  z.object({
    type: z.literal("unconsumeTrackedEntities"),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    )
  }),
  z.object({
    type: z.literal("maintenanceDispatchInventory"),
    maintenanceDispatchId: z.string(),
    itemId: z.string(),
    unitOfMeasureCode: z.string(),
    quantity: z.number()
  }),
  z.object({
    type: z.literal("maintenanceDispatchTrackedEntities"),
    maintenanceDispatchId: z.string(),
    itemId: z.string(),
    unitOfMeasureCode: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    ),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional()
  }),
  z.object({
    type: z.literal("maintenanceDispatchUnconsume"),
    maintenanceDispatchItemId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    )
  }),
  z.object({
    type: z.literal("maintenanceDispatchUnissue"),
    maintenanceDispatchItemId: z.string()
  })
]);

export const postPickingInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inventory"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("unpickInventory"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("serial"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    fromStorageUnitId: z.string().nullable(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("batch"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    fromStorageUnitId: z.string().nullable(),
    quantity: z.number().positive(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("unpickSerial"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("unpickBatch"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string()
  }),
  // Return the un-consumed remainder of a tracked (batch/serial) allocation from
  // the lineside shelf back to the warehouse source at job complete. Unlike
  // unpickBatch (all-or-nothing, keyed to the original picked entity), this walks
  // the picked entity's split lineage and moves whatever is still physically on
  // hand at the lineside bin — because a partial consume splits the remainder
  // into a NEW entity the picking line never references.
  z.object({
    type: z.literal("returnPickedRemainder"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string()
  }),
  // Sweep what one Done operation left at lineside, or a whole job's
  // remainder. An operation whose job is Completed (it was the last one)
  // sweeps the whole job under either return policy; otherwise the operation
  // sweep no-ops unless companySettings.returnPickedMaterialTiming =
  // 'operation'. The job sweep requires job.status Completed or Cancelled
  // (cancelJob sweeps after it flips the status). Tracked lines
  // return via the split-lineage walk; untracked lines return
  // picked − returned − max(issued, owed) per job material, where `owed` holds
  // back what completion-time backflush still needs.
  z.object({
    type: z.literal("returnOperationRemainders"),
    jobOperationId: z.string()
  }),
  z.object({
    type: z.literal("returnJobRemainders"),
    jobId: z.string()
  })
]);

export const postInventoryAdjustmentInput = z
  .object({
    adjustmentType: z.enum([
      "Positive Adjmt.",
      "Negative Adjmt.",
      "Set Quantity",
      "Scrap",
      "Unscrap"
    ]),
    itemId: z.string(),
    // Optional for Unscrap (resolved from the original scrap movement);
    // required for every other type, enforced by the app-layer validator.
    locationId: z.string().optional().nullable(),
    storageUnitId: z.string().optional().nullable(),
    trackedEntityId: z.string().optional().nullable(),
    // 0 is legal for Set Quantity (set to zero) and for a tracked Scrap/Unscrap
    // (full-entity quantity is resolved server-side); a negative magnitude is
    // never valid — direction comes from adjustmentType, not the sign.
    quantity: z.number().min(0),
    readableId: z.string().optional().nullable(),
    originalStorageUnitId: z.string().optional().nullable(),
    expirationDate: z.string().optional().nullable(),
    comment: z.string().optional().nullable(),
    // Required for Scrap (enforced below) — lands on the itemLedger row and
    // as a ScrapReason journal dimension. Unscrap
    // omits it: the reason is inherited from the original scrap movement.
    scrapReasonId: z.string().optional().nullable(),
    // Unscrap: the original scrap itemLedger row to reverse against. Optional —
    // resolved server-side from the tracked entity's newest Scrap movement.
    unscrapOfItemLedgerId: z.string().optional().nullable()
  })
  .superRefine((data, ctx) => {
    if (data.adjustmentType === "Scrap" && !data.scrapReasonId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scrapReasonId"],
        message: "Scrap reason is required"
      });
    }
  });

/**
 * `success: false` means nothing was posted, with `error` null: the event is
 * not complete yet, or it was posted under the old job-tagged scheme, and
 * `reason` says which. A caller that needs the event posted must read
 * `success`; the operation-finish and job-completion catch-ups post it later.
 */
export type PostProductionEventResult =
  | { success: true }
  | { success: false; reason: string };

export const postProductionEventInput = z.object({
  productionEventId: z.string(),
  // Reverse the net journal lines previously posted for this event (e.g.
  // before deleting it) instead of posting its current state.
  reverse: z.boolean().optional()
});

export const batchOperationsInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    jobOperationIds: z.array(z.string()).min(1),
    locationId: z.string(),
    workCenterId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    // Create straight onto the floor (Active) instead of staging as Planned.
    release: z.boolean().optional(),
    // Output lot identity is planned, never typed on the floor: either every
    // member completes into one lot (mergeOutput + outputLotNumber), or each
    // batch-tracked member gets its own number (lotNumbers).
    mergeOutput: z.boolean().optional(),
    outputLotNumber: z.string().trim().min(1).optional().nullable(),
    lotNumbers: z
      .array(
        z.object({
          jobOperationId: z.string(),
          lotNumber: z.string().trim().min(1)
        })
      )
      .optional()
  }),
  z.object({
    type: z.literal("add"),
    batchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1)
  }),
  z.object({
    type: z.literal("remove"),
    batchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1)
  }),
  z.object({
    type: z.literal("update"),
    batchId: z.string(),
    workCenterId: z.string().nullable().optional()
  }),
  z.object({
    type: z.literal("release"),
    batchId: z.string()
  }),
  z.object({
    type: z.literal("unrelease"),
    batchId: z.string()
  }),
  z.object({
    type: z.literal("dissolve"),
    batchId: z.string()
  }),
  z.object({
    type: z.literal("complete"),
    batchId: z.string(),
    members: z
      .array(
        z.object({
          jobOperationId: z.string(),
          // Decimal, matching the MES validator: productionQuantity.quantity is
          // NUMERIC. An `.int()` here rejected every fractional completion the
          // (already decimal) MES validator let through. Rounded at parse.
          quantity: z
            .number()
            .min(0)
            .transform((v) => round(v)),
          scrapQuantity: z
            .number()
            .min(0)
            .transform((v) => round(v))
            .optional(),
          // Batch-tracked output: the member's WIP entity to finalize as the
          // produced lot, and the batch number to stamp on it.
          trackedEntityId: z.string().optional().nullable(),
          batchNumber: z.string().optional().nullable(),
          // "Not in this run": detach the member back to the schedule instead
          // of completing it. Its quantities must be 0.
          excluded: z.boolean().optional()
        })
      )
      .min(1)
  })
]);

export const recalculateInput = z.object({
  type: z.enum(["jobMakeMethodRequirements", "jobRequirements"]),
  id: z.string()
});

export const triggerReworkInput = z.object({
  jobId: z.string().min(1),
  triggeredAtJobOperationId: z.string().min(1),
  targetJobOperationId: z.string().min(1),
  reason: z.string().min(1),
  quantity: z.number().positive(),
  trackedEntityIds: z.array(z.string()).optional(),
  inspectionId: z.string().optional()
});

export const rescheduleInput = z.object({ jobId: z.string() });

export const postMaintenanceEventInput = z.object({
  maintenanceDispatchIds: z.array(z.string()).min(1)
});

export const createInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("nonConformanceTasks"),
    id: z.string()
  }),
  z.object({
    type: z.literal("purchaseOrderFromJob"),
    jobId: z.string(),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string())
  }),
  z.object({
    type: z.literal("receiptDefault"),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("receiptFromPurchaseOrder"),
    locationId: z.string().optional(),
    purchaseOrderId: z.string(),
    receiptId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromInboundTransfer"),
    warehouseTransferId: z.string(),
    receiptId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromSalesReturnOrder"),
    salesReturnOrderId: z.string(),
    receiptId: z.string().optional(),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromWarehouseTransfer"),
    warehouseTransferId: z.string(),
    receiptId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    receiptId: z.string(),
    receiptLineId: z.string()
  }),
  z.object({
    type: z.literal("shipmentDefault"),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromPurchaseOrder"),
    locationId: z.string(),
    purchaseOrderId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromWarehouseTransfer"),
    warehouseTransferId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromPurchaseReturnOrder"),
    purchaseReturnOrderId: z.string(),
    shipmentId: z.string().optional(),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromSalesReturnOrder"),
    salesReturnOrderId: z.string(),
    shipmentId: z.string().optional(),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrder"),
    locationId: z.string(),
    salesOrderId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrderLine"),
    locationId: z.string(),
    salesOrderLineId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    shipmentId: z.string(),
    shipmentLineId: z.string()
  }),
  z.object({
    type: z.literal("shipmentFromRentalAgreement"),
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromRentalAgreement"),
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string().optional()
  }),
  z.object({
    type: z.literal("journalEntry")
  })
]);

export type CreateInput = z.input<typeof createInput>;

export type CreateResults = {
  nonConformanceTasks: { success: true };
  purchaseOrderFromJob: {
    success: true;
    purchaseOrderIdsBySupplierId: Record<string, string>;
  };
};

export type CreateResultFor<T extends CreateInput["type"]> =
  T extends keyof CreateResults ? CreateResults[T] : { id: string };

export type CreateResult = CreateResultFor<CreateInput["type"]>;

/**
 * What MES may call, with the `type` values it sends (null: the input has no
 * `type`). The ERP's internal endpoint refuses anything else.
 */
export const MES_POSTINGS = {
  issue: [
    "convertEntity",
    "jobOperation",
    "jobOperationBatchComplete",
    "jobOperationScrap",
    "jobOperationSerialComplete",
    "maintenanceDispatchInventory",
    "maintenanceDispatchTrackedEntities",
    "maintenanceDispatchUnissue",
    "mergeTrackedEntities",
    "partToOperation",
    "scrapTrackedEntity",
    "trackedEntitiesToBatch",
    "trackedEntitiesToOperation",
    "unconsumeTrackedEntities"
  ],
  "post-picking": [
    "inventory",
    "unpickInventory",
    "serial",
    "batch",
    "unpickSerial",
    "unpickBatch",
    "returnOperationRemainders"
  ],
  "post-production-event": null,
  "post-maintenance-event": null,
  "post-inventory-adjustment": null,
  create: ["nonConformanceTasks"],
  "batch-operations": ["complete"],
  recalculate: ["jobRequirements"],
  "trigger-rework": null
} as const satisfies Record<string, readonly string[] | null>;

export type MesPostingName = keyof typeof MES_POSTINGS;

/** Whether MES may call `name` with this input. */
export function isMesPosting(
  name: string,
  input: unknown
): name is MesPostingName {
  if (!Object.hasOwn(MES_POSTINGS, name)) return false;
  const types: readonly string[] | null = MES_POSTINGS[name as MesPostingName];
  if (types === null) return true;
  const type = (input as { type?: unknown } | null)?.type;
  return typeof type === "string" && types.includes(type);
}
