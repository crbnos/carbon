// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The production module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in production.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  envelopes,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  activateAssemblyInstructionVersion,
  convertSalesOrderLinesToJobs,
  copyAssemblyInstructionAsVersion,
  createJobDocumentUploadUrl,
  deleteAssemblyComponentMapping,
  deleteAssemblyInstruction,
  deleteAssemblyInstructionStep,
  deleteAssemblyInstructionStepMaterial,
  deleteAssemblyInstructionStepSlide,
  deleteAssemblyInstructionStepTool as deleteAssemblyInstructionStepToolRow,
  deleteAssemblySubAssembly,
  deleteAssemblyUnit,
  deleteFailureMode,
  deleteJobOperationParameter,
  deleteJobOperationStep,
  deleteJobOperationStepSlide,
  deleteJobOperationTool,
  deleteMaintenanceDispatch,
  deleteMaintenanceDispatchEvent,
  deleteMaintenanceSchedule,
  deleteProcedure,
  deleteProcedureParameter,
  deleteProcedureStep,
  deleteProductionEvent,
  deleteProductionQuantity,
  deleteScrapReason,
  duplicateJobOperationStep,
  getActiveEmployeeAbilities,
  getActiveJobOperationByJobId,
  getActiveJobOperationsByLocation,
  getActiveProductionEvents,
  getAssemblyComponentMappings,
  getAssemblyInstruction,
  getAssemblyInstructionStepMaterials,
  getAssemblyInstructionStepSlides,
  getAssemblyInstructionSteps,
  getAssemblyInstructionStepTools,
  getAssemblyInstructions,
  getAssemblyInstructionsForItem,
  getAssemblyInstructionVersions,
  getAssemblyPlanJson,
  getAssemblyUnits,
  getBatchableOperations,
  getBatchableProcesses,
  getBatchOutputLots,
  getCapacityReservationsForResources,
  getCompletionJobs,
  getDemandProjections,
  getFailureMode,
  getFailureModes,
  getFailureModesList,
  getFlattenedBomMaterials,
  getJob,
  getJobByOperationId,
  getJobDocuments,
  getJobDocumentsWithItemId,
  getJobExpediteForecast,
  getJobMakeMethodById,
  getJobMaterialItemIds,
  getJobMaterialsByMethodId,
  getJobMaterialsWithQuantityOnHand,
  getJobMethodTree,
  getJobOperationAttachments,
  getJobOperationBatchEvents,
  getJobOperationBatches,
  getJobOperationBatchMemberStats,
  getJobOperationBatchMembers,
  getJobOperationBatchWithMembers,
  getJobOperationDependencies,
  getJobOperationStepRecords,
  getJobOperations,
  getJobOperationsByMethodId,
  getJobOperationsList,
  getJobOrderStatusMap,
  getJobPurchaseOrderLines,
  getJobReceiptSnapshot,
  getJobReleaseReadiness,
  getJobs,
  getJobsByDateRange,
  getJobsBySalesOrderLine,
  getJobsList,
  getLatestAssemblyPlanJob,
  getLocationEmployees,
  getMaintenanceDispatch,
  getMaintenanceDispatchComments,
  getMaintenanceDispatchEvents,
  getMaintenanceDispatchItems,
  getMaintenanceDowntimeForResources,
  getMaintenanceSchedule,
  getOutsideOperationsByJobId,
  getPeopleAbsences,
  getPeopleAbsencesRange,
  getPeopleAssignments,
  getPeopleAssignmentsRange,
  getPeopleCapacityOperations,
  getProcedure,
  getProcedures,
  getProceduresList,
  getProcedureVersions,
  getProductionDataByOperations,
  getProductionEvent,
  getProductionEvents,
  getProductionPlanning,
  getProductionProjections,
  getProductionQuantities,
  getProductionQuantity,
  getRootMakeMethod,
  getScrapReason,
  getScrapReasons,
  getScrapReasonsList,
  getTrackedEntitiesByJobId,
  getTrackedEntityByJobId,
  getUnbatchedBatchableOperationCount,
  getUnscheduledJobs,
  getWorkCenterRequiredAbilities,
  getWorkCenterReservationsRange,
  getWorkCenterShifts,
  insertAssemblyInstructionStep,
  insertJob,
  makeAssemblySubAssembly,
  notifyScheduleInputsChanged,
  recalculateJobRequirements,
  runMRP,
  setJobMaterialStepLink,
  setJobOperationToolStepLink,
  toViewerStep,
  ungroupAssemblySubAssembly,
  updateAssemblyInstructionStatus,
  updateAssemblyInstructionStepMaterialOrder,
  updateAssemblyInstructionStepOrder,
  updateAssemblyInstructionStepStatus,
  updateAssemblyStepHiddenComponents,
  updateAssemblyStepMotion,
  updateAssemblySubAssembly,
  updateJobBatchNumber,
  updateJobMaterialOrder,
  updateJobOperationStepOrder,
  updateKanbanJob,
  updateMethodOperationStepOrder,
  updateProcedureStepOrder,
  updateQuoteOperationStepOrder,
  upsertAssemblyInstruction,
  upsertAssemblyInstructionStep,
  upsertAssemblyInstructionStepMaterial,
  upsertAssemblyInstructionStepSlide,
  upsertAssemblyInstructionStepTool as upsertAssemblyInstructionStepToolRow,
  upsertAssemblyUnit,
  upsertFailureMode,
  upsertJobOperationParameter,
  upsertJobOperationStep,
  upsertJobOperationStepSlide,
  upsertJobOperationTool,
  upsertMaintenanceDispatchComment,
  upsertMaintenanceDispatchEvent,
  upsertMaintenanceDispatchItem,
  upsertMaintenanceSchedule,
  upsertMakeMethodFromJob,
  upsertMakeMethodFromJobMethod,
  upsertProcedure,
  upsertProcedureParameter,
  upsertProcedureStep,
  upsertScrapReason
} from "./production.service";

/**
 * Convert sales order lines to jobs
 *
 * @mcp
 */
export const convertSalesOrderLinesToJobsTool = defineServiceFn({
  input: z.looseObject({ orderId: z.string() }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await convertSalesOrderLinesToJobs(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Delete job operation step
 *
 * @mcp destructive
 */
export const deleteJobOperationStepTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteJobOperationStep(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete job operation step slide
 *
 * @mcp destructive
 */
export const deleteJobOperationStepSlideTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteJobOperationStepSlide(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete job operation parameter
 *
 * @mcp destructive
 */
export const deleteJobOperationParameterTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteJobOperationParameter(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete job operation tool
 *
 * @mcp destructive
 */
export const deleteJobOperationToolTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteJobOperationTool(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete procedure
 *
 * @mcp destructive
 */
export const deleteProcedureTool = defineServiceFn({
  input: z.looseObject({ procedureId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteProcedure(ctx.asCaller.supabase, input.procedureId as never)
    );
  }
});

/**
 * Delete procedure step
 *
 * @mcp destructive
 */
export const deleteProcedureStepTool = defineServiceFn({
  input: z.looseObject({ procedureStepId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteProcedureStep(
        ctx.asCaller.supabase,
        input.procedureStepId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete procedure parameter
 *
 * @mcp destructive
 */
export const deleteProcedureParameterTool = defineServiceFn({
  input: z.looseObject({ procedureParameterId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteProcedureParameter(
        ctx.asCaller.supabase,
        input.procedureParameterId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete production event
 *
 * @mcp destructive
 */
export const deleteProductionEventTool = defineServiceFn({
  input: z.looseObject({ productionEventId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteProductionEvent(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.productionEventId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Delete production quantity
 *
 * @mcp destructive
 */
export const deleteProductionQuantityTool = defineServiceFn({
  input: z.looseObject({ productionQuantityId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteProductionQuantity(
        ctx.asCaller.supabase,
        input.productionQuantityId as never
      )
    );
  }
});

/**
 * Get active job operation by job id
 *
 * @mcp read
 */
export const getActiveJobOperationByJobIdTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getActiveJobOperationByJobId(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get active job operations by location
 *
 * @mcp read
 */
export const getActiveJobOperationsByLocationTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    workCenterIds: z.array(z.string()).optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getActiveJobOperationsByLocation(
        ctx.asCaller.supabase,
        input.locationId as never,
        stamp(ctx, input.workCenterIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get jobs by date range
 *
 * @mcp read
 */
export const getJobsByDateRangeTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    startDate: z.string(),
    endDate: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobsByDateRange(
        ctx.asCaller.supabase,
        input.locationId as never,
        input.startDate as never,
        input.endDate as never
      )
    );
  }
});

/**
 * Get unscheduled jobs
 *
 * @mcp read
 */
export const getUnscheduledJobsTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getUnscheduledJobs(ctx.asCaller.supabase, input.locationId as never)
    );
  }
});

/**
 * Get active production events
 *
 * @mcp read
 */
export const getActiveProductionEventsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return envelope(
      ctx,
      await getActiveProductionEvents(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Delete scrap reason
 *
 * @mcp destructive
 */
export const deleteScrapReasonTool = defineServiceFn({
  input: z.looseObject({ scrapReasonId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteScrapReason(
        ctx.asCaller.supabase,
        input.scrapReasonId as never
      )
    );
  }
});

/**
 * Delete failure mode
 *
 * @mcp destructive
 */
export const deleteFailureModeTool = defineServiceFn({
  input: z.looseObject({ failureModeId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteFailureMode(
        ctx.asCaller.supabase,
        input.failureModeId as never
      )
    );
  }
});

/**
 * Delete maintenance dispatch
 *
 * @mcp destructive
 */
export const deleteMaintenanceDispatchTool = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaintenanceDispatch(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Delete maintenance dispatch event
 *
 * @mcp destructive
 */
export const deleteMaintenanceDispatchEventTool = defineServiceFn({
  input: z.looseObject({ eventId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaintenanceDispatchEvent(
        ctx.asCaller.supabase,
        input.eventId as never
      )
    );
  }
});

/**
 * Delete maintenance schedule
 *
 * @mcp destructive
 */
export const deleteMaintenanceScheduleTool = defineServiceFn({
  input: z.looseObject({ scheduleId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaintenanceSchedule(
        ctx.asCaller.supabase,
        input.scheduleId as never
      )
    );
  }
});

/**
 * Get demand projections
 *
 * @mcp read
 */
export const getDemandProjectionsTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    periodIds: z.array(z.string())
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDemandProjections(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job documents
 *
 * @mcp read
 */
export const getJobDocumentsTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().nullable(),
    salesOrderLineId: z.string().nullable().optional(),
    quoteLineId: z.string().nullable().optional(),
    itemId: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getJobDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job documents with item id
 *
 * @mcp read
 */
export const getJobDocumentsWithItemIdTool = defineServiceFn({
  input: z.looseObject({
    job: z.looseObject({
      id: z.string().nullable(),
      salesOrderLineId: z.string().nullable(),
      quoteLineId: z.string().nullable()
    }),
    itemId: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getJobDocumentsWithItemId(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.job, ["companyId"]) as never,
        input.itemId as never
      )
    );
  }
});

/**
 * Get job
 *
 * @mcp read
 */
export const getJobTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJob(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get job expedite forecast
 *
 * @mcp read
 */
export const getJobExpediteForecastTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobExpediteForecast(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.jobId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get job by operation id
 *
 * @mcp read
 */
export const getJobByOperationIdTool = defineServiceFn({
  input: z.looseObject({ operationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobByOperationId(
        ctx.asCaller.supabase,
        input.operationId as never
      )
    );
  }
});

/**
 * Get job purchase order lines
 *
 * @mcp read
 */
export const getJobPurchaseOrderLinesTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobPurchaseOrderLines(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * The Outbound report: open jobs at a location that fill a sales order, with where each one ships (RPC `get_completion_jobs`), ordered by the plant-calendar day…
 *
 * @mcp read
 */
export const getCompletionJobsTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    timeZone: z.string(),
    throughDate: z.string().nullable(),
    search: z.string().nullable()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCompletionJobs(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get capacity reservations for resources
 *
 * @mcp read
 */
export const getCapacityReservationsForResourcesTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string().optional(),
    window: z
      .looseObject({ from: z.string(), to: z.string() })
      .describe(
        "Explicit [from, to) instant window (ISO strings) for the resource Gantt's day/week/shift views — returns reservations that OVERLAP it. Omit to keep the default forward horizon (everything ending within the last day onward)."
      )
      .optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCapacityReservationsForResources(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        stamp(ctx, input.window, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get maintenance downtime for resources
 *
 * @mcp read
 */
export const getMaintenanceDowntimeForResourcesTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string().optional() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaintenanceDowntimeForResources(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get jobs
 *
 * @mcp read
 */
export const getJobsTool = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getJobs(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get jobs by sales order line
 *
 * @mcp read
 */
export const getJobsBySalesOrderLineTool = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobsBySalesOrderLine(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Get jobs list
 *
 * @mcp read
 */
export const getJobsListTool = defineServiceFn({
  input: z.looseObject({
    statuses: z
      .array(
        z.enum([
          "Draft",
          "Ready",
          "In Progress",
          "Paused",
          "Completed",
          "Cancelled",
          "Overdue",
          "Due Today",
          "Planned",
          "Closed"
        ])
      )
      .optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobsList(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.statuses, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job make method by id
 *
 * @mcp read
 */
export const getJobMakeMethodByIdTool = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobMakeMethodById(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get root make method
 *
 * @mcp read
 */
export const getRootMakeMethodTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRootMakeMethod(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job materials with quantity on hand
 *
 * @mcp read
 */
export const getJobMaterialsWithQuantityOnHandTool = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    locationId: z.string(),
    args: z.looseObject({
      search: z.string().nullable().optional(),
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0)
    })
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobMaterialsWithQuantityOnHand(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id,
        input.locationId as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job material item ids
 *
 * @mcp read
 */
export const getJobMaterialItemIdsTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobMaterialItemIds(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job order status map
 *
 * @mcp read
 */
export const getJobOrderStatusMapTool = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    locationId: z.string(),
    jobStatus: z.string().nullable(),
    materials: z.array(
      z.looseObject({
        description: z.string(),
        estimatedQuantity: z.number(),
        id: z.string(),
        itemReadableId: z.string(),
        itemScrapPercentage: z.number(),
        itemTrackingType: z.enum([
          "Inventory",
          "Non-Inventory",
          "Serial",
          "Batch"
        ]),
        jobMakeMethodId: z.string(),
        jobMaterialItemId: z.string(),
        methodType: z.enum([
          "Purchase to Order",
          "Pull from Inventory",
          "Make to Order"
        ]),
        name: z.string(),
        quantityFromProductionOrderInStorageUnit: z.number(),
        quantityFromProductionOrderNotInStorageUnit: z.number(),
        quantityInTransitToStorageUnit: z.number(),
        quantityIssued: z.number(),
        quantityOnHandInStorageUnit: z.number(),
        quantityOnHandNotInStorageUnit: z.number(),
        quantityOnProductionOrder: z.number(),
        quantityOnPurchaseOrder: z.number(),
        quantityOnSalesOrder: z.number(),
        quantityPerParent: z.number(),
        storageUnitId: z.string(),
        storageUnitName: z.string(),
        substitutedFromItemId: z.string(),
        thumbnailPath: z.string(),
        type: z.enum([
          "Part",
          "Service",
          "Material",
          "Tool",
          "Fixture",
          "Consumable"
        ]),
        unitOfMeasureCode: z.string()
      })
    ),
    asOfDate: z.string().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getJobOrderStatusMap(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id,
        input.locationId as never,
        stamp(ctx, input.jobStatus, ["companyId"]) as never,
        stamp(ctx, input.materials, ["companyId"]) as never,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get job method tree
 *
 * @mcp read
 */
export const getJobMethodTreeTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobMethodTree(ctx.asCaller.supabase, input.jobId as never)
    );
  }
});

/**
 * Get job materials by method id
 *
 * @mcp read
 */
export const getJobMaterialsByMethodIdTool = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobMaterialsByMethodId(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never
      )
    );
  }
});

/**
 * Get job operations
 *
 * @mcp read
 */
export const getJobOperationsTool = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    args: z.looseObject({
      search: z.string().nullable().optional(),
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0)
    })
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getJobOperations(
        ctx.asCaller.supabase,
        input.jobId as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job operation dependencies
 *
 * @mcp read
 */
export const getJobOperationDependenciesTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobOperationDependencies(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * Get job operation attachments
 *
 * @mcp read
 */
export const getJobOperationAttachmentsTool = defineServiceFn({
  input: z.looseObject({ jobOperationIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getJobOperationAttachments(
        ctx.asCaller.supabase,
        stamp(ctx, input.jobOperationIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job operations list
 *
 * @mcp read
 */
export const getJobOperationsListTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobOperationsList(ctx.asCaller.supabase, input.jobId as never)
    );
  }
});

/**
 * Get job operations by method id
 *
 * @mcp read
 */
export const getJobOperationsByMethodIdTool = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobOperationsByMethodId(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never
      )
    );
  }
});

/**
 * Get job operation step records
 *
 * @mcp read
 */
export const getJobOperationStepRecordsTool = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getJobOperationStepRecords(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get outside operations by job id
 *
 * @mcp read
 */
export const getOutsideOperationsByJobIdTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOutsideOperationsByJobId(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get procedure
 *
 * @mcp read
 */
export const getProcedureTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getProcedure(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get procedure versions
 *
 * @mcp read
 */
export const getProcedureVersionsTool = defineServiceFn({
  input: z.looseObject({ name: z.string(), version: z.number() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getProcedureVersions(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get procedures
 *
 * @mcp read
 */
export const getProceduresTool = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getProcedures(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get procedures list
 *
 * @mcp read
 */
export const getProceduresListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return envelope(
      ctx,
      await getProceduresList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get production event
 *
 * @mcp read
 */
export const getProductionEventTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getProductionEvent(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get production events
 *
 * @mcp read
 */
export const getProductionEventsTool = defineServiceFn({
  input: z.looseObject({
    jobOperationIds: z.array(z.string()),
    args: z.looseObject({
      search: z.string().nullable().optional(),
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0)
    })
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getProductionEvents(
        ctx.asCaller.supabase,
        stamp(ctx, input.jobOperationIds, ["companyId"]) as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get production planning
 *
 * @mcp read
 */
export const getProductionPlanningTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    periods: z.array(z.string()),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional(),
      asOf: z.string(),
      actionTypes: z.array(z.string()).optional(),
      actionAssignees: z.array(z.string()).optional()
    })
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getProductionPlanning(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        stamp(ctx, input.periods, ["companyId"]) as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get production projections
 *
 * @mcp read
 */
export const getProductionProjectionsTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    periods: z.array(z.string()),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getProductionProjections(
        ctx.asCaller.supabase,
        input.locationId as never,
        stamp(ctx, input.periods, ["companyId"]) as never,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get production quantity
 *
 * @mcp read
 */
export const getProductionQuantityTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getProductionQuantity(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get production quantities
 *
 * @mcp read
 */
export const getProductionQuantitiesTool = defineServiceFn({
  input: z.looseObject({
    jobOperationIds: z.array(z.string()),
    args: z.looseObject({
      search: z.string().nullable().optional(),
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0)
    })
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getProductionQuantities(
        ctx.asCaller.supabase,
        stamp(ctx, input.jobOperationIds, ["companyId"]) as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get production data by operations
 *
 * @mcp read
 */
export const getProductionDataByOperationsTool = defineServiceFn({
  input: z.looseObject({ jobOperationIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getProductionDataByOperations(
        ctx.asCaller.supabase,
        stamp(ctx, input.jobOperationIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get scrap reasons list
 *
 * @mcp read
 */
export const getScrapReasonsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return envelope(
      ctx,
      await getScrapReasonsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get scrap reason
 *
 * @mcp read
 */
export const getScrapReasonTool = defineServiceFn({
  input: z.looseObject({ scrapReasonId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getScrapReason(ctx.asCaller.supabase, input.scrapReasonId as never)
    );
  }
});

/**
 * Get scrap reasons
 *
 * @mcp read
 */
export const getScrapReasonsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getScrapReasons(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get failure mode
 *
 * @mcp read
 */
export const getFailureModeTool = defineServiceFn({
  input: z.looseObject({ failureModeId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFailureMode(ctx.asCaller.supabase, input.failureModeId as never)
    );
  }
});

/**
 * Get failure modes
 *
 * @mcp read
 */
export const getFailureModesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getFailureModes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get failure modes list
 *
 * @mcp read
 */
export const getFailureModesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return envelope(
      ctx,
      await getFailureModesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get maintenance dispatch
 *
 * @mcp read
 */
export const getMaintenanceDispatchTool = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaintenanceDispatch(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance dispatch comments
 *
 * @mcp read
 */
export const getMaintenanceDispatchCommentsTool = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaintenanceDispatchComments(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance dispatch events
 *
 * @mcp read
 */
export const getMaintenanceDispatchEventsTool = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaintenanceDispatchEvents(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance dispatch items
 *
 * @mcp read
 */
export const getMaintenanceDispatchItemsTool = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaintenanceDispatchItems(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance schedule
 *
 * @mcp read
 */
export const getMaintenanceScheduleTool = defineServiceFn({
  input: z.looseObject({ scheduleId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaintenanceSchedule(
        ctx.asCaller.supabase,
        input.scheduleId as never
      )
    );
  }
});

/**
 * Get tracked entity by job id
 *
 * @mcp read
 */
export const getTrackedEntityByJobIdTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrackedEntityByJobId(ctx.asCaller.supabase, input.jobId as never)
    );
  }
});

/**
 * Get tracked entities by job id
 *
 * @mcp read
 */
export const getTrackedEntitiesByJobIdTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrackedEntitiesByJobId(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * What a job has already received to inventory: its received quantity and the tracked entities its receipts posted
 *
 * @mcp read
 */
export const getJobReceiptSnapshotTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getJobReceiptSnapshot(
        ctx.asSystem.pg,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Recalculate job requirements
 *
 * @mcp
 */
export const recalculateJobRequirementsTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await recalculateJobRequirements(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Run m r p
 *
 * @mcp
 */
export const runMRPTool = defineServiceFn({
  input: z.looseObject({
    type: z.enum([
      "company",
      "location",
      "job",
      "salesOrder",
      "item",
      "purchaseOrder"
    ]),
    id: z.string()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await runMRP(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Update job batch number
 *
 * @mcp
 */
export const updateJobBatchNumberTool = defineServiceFn({
  input: z.looseObject({
    trackedEntityId: z.string(),
    value: z.string().nullable()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateJobBatchNumber(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.trackedEntityId as never,
        input.value as never
      )
    );
  }
});

/**
 * Get job release readiness
 *
 * @mcp read
 */
export const getJobReleaseReadinessTool = defineServiceFn({
  input: z.looseObject({ jobIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobReleaseReadiness(
        ctx.asCaller.supabase,
        stamp(ctx, input.jobIds, ["companyId"]) as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Update job material order
 *
 * @mcp
 */
export const updateJobMaterialOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateJobMaterialOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update job operation step order
 *
 * @mcp
 */
export const updateJobOperationStepOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateJobOperationStepOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update kanban job
 *
 * @mcp
 */
export const updateKanbanJobTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), jobId: z.string().nullable() }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateKanbanJob(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Update quote operation step order
 *
 * @mcp
 */
export const updateQuoteOperationStepOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateQuoteOperationStepOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update method operation step order
 *
 * @mcp
 */
export const updateMethodOperationStepOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateMethodOperationStepOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update procedure step order
 *
 * @mcp
 */
export const updateProcedureStepOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateProcedureStepOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * `options.source` is telemetry-only: which surface raised the job
 *
 * @mcp
 */
export const insertJobTool = defineServiceFn({
  input: z.looseObject({
    input: z.looseObject({
      itemId: z.string(),
      quantity: z.number(),
      jobId: z.string().optional(),
      locationId: z.string().optional(),
      dueDate: z.string().optional(),
      startDate: z.string().optional(),
      priority: z.number().optional(),
      status: z
        .enum([
          "Draft",
          "Planned",
          "Ready",
          "In Progress",
          "Paused",
          "Completed",
          "Closed",
          "Cancelled",
          "Overdue",
          "Due Today"
        ])
        .optional(),
      deadlineType: z
        .enum(["ASAP", "Hard Deadline", "Soft Deadline", "No Deadline"])
        .optional(),
      storageUnitId: z.string().optional(),
      unitOfMeasureCode: z.string().optional(),
      customerId: z.string().optional(),
      salesOrderId: z.string().optional(),
      salesOrderLineId: z.string().optional(),
      quoteId: z.string().optional(),
      quoteLineId: z.string().optional(),
      modelUploadId: z.string().optional(),
      notes: z.string().optional(),
      customFields: z.unknown().optional(),
      configuration: z.record(z.string(), z.unknown()).optional(),
      fixedAssetClassId: z.string().nullable().optional(),
      fixedAssetId: z.string().nullable().optional()
    }),
    options: z
      .looseObject({
        skipMethod: z.boolean().optional(),
        skipRecalculate: z.boolean().optional(),
        methodSource: z.enum(["item", "quoteLine"]).optional(),
        source: z
          .enum([
            "salesOrder",
            "kanban",
            "workflow",
            "unknown",
            "erp",
            "bulk",
            "mrp",
            "api"
          ])
          .nullable()
          .optional()
      })
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertJob(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input.input, [
          "companyId",
          "createdBy",
          "updatedBy"
        ]) as never,
        stamp(ctx, input.options, [
          "companyId",
          "createdBy",
          "updatedBy"
        ]) as never
      )
    );
  }
});

/**
 * Create a job operation step
 *
 * @remarks
 * Upsert job operation step
 *
 * @mcp
 */
export const upsertJobOperationStepCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationStep(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a job operation step
 *
 * @remarks
 * Upsert job operation step
 *
 * @mcp
 */
export const upsertJobOperationStepUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationStep(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Duplicate job operation step
 *
 * @mcp
 */
export const duplicateJobOperationStepTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await duplicateJobOperationStep(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a job operation step slide
 *
 * @remarks
 * Upsert job operation step slide
 *
 * @mcp
 */
export const upsertJobOperationStepSlideCreateTool = defineServiceFn({
  input: z.looseObject({
    stepId: z.string().min(1),
    imagePath: z.string().optional(),
    modelUploadId: z.string().optional(),
    caption: z.string().optional(),
    sortOrder: z.number().min(0).optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
    annotations: z
      .array(
        z.looseObject({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          label: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
          toolId: z.string().nullable().optional()
        })
      )
      .nullable()
      .optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationStepSlide(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a job operation step slide
 *
 * @remarks
 * Upsert job operation step slide
 *
 * @mcp
 */
export const upsertJobOperationStepSlideUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      stepId: z.string().min(1),
      imagePath: z.string().optional(),
      modelUploadId: z.string().optional(),
      caption: z.string().optional(),
      sortOrder: z.number().min(0).optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
      annotations: z
        .array(
          z.looseObject({
            id: z.string(),
            x: z.number(),
            y: z.number(),
            label: z.string().nullable().optional(),
            color: z.string().nullable().optional(),
            toolId: z.string().nullable().optional()
          })
        )
        .nullable()
        .optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationStepSlide(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a job operation parameter
 *
 * @remarks
 * Upsert job operation parameter
 *
 * @mcp
 */
export const upsertJobOperationParameterCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationParameter(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a job operation parameter
 *
 * @remarks
 * Upsert job operation parameter
 *
 * @mcp
 */
export const upsertJobOperationParameterUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationParameter(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a job operation tool
 *
 * @remarks
 * Upsert job operation tool
 *
 * @mcp
 */
export const upsertJobOperationToolCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    toolId: z.string().min(1),
    quantity: z.number().min(0.000001),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationTool(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a job operation tool
 *
 * @remarks
 * Upsert job operation tool
 *
 * @mcp
 */
export const upsertJobOperationToolUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      toolId: z.string().min(1),
      quantity: z.number().min(0.000001),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertJobOperationTool(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Set job material step link
 *
 * @mcp destructive
 */
export const setJobMaterialStepLinkTool = defineServiceFn({
  input: z.looseObject({
    jobMaterialId: z.string(),
    jobOperationStepId: z.string(),
    linked: z.boolean(),
    quantity: z.number().nullable().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await setJobMaterialStepLink(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Set job operation tool step link
 *
 * @mcp destructive
 */
export const setJobOperationToolStepLinkTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string(),
    toolId: z.string(),
    jobOperationStepId: z.string(),
    linked: z.boolean()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await setJobOperationToolStepLink(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert make method from job
 *
 * @mcp
 */
export const upsertMakeMethodFromJobTool = defineServiceFn({
  input: z.looseObject({
    sourceId: z.string(),
    targetId: z.string(),
    parts: z
      .looseObject({
        billOfMaterial: z.boolean(),
        billOfProcess: z.boolean(),
        parameters: z.boolean(),
        tools: z.boolean(),
        steps: z.boolean(),
        workInstructions: z.boolean()
      })
      .optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMakeMethodFromJob(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Upsert make method from job method
 *
 * @mcp
 */
export const upsertMakeMethodFromJobMethodTool = defineServiceFn({
  input: z.looseObject({
    sourceId: z.string(),
    targetId: z.string(),
    parts: z
      .looseObject({
        billOfMaterial: z.boolean(),
        billOfProcess: z.boolean(),
        parameters: z.boolean(),
        tools: z.boolean(),
        steps: z.boolean(),
        workInstructions: z.boolean()
      })
      .optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMakeMethodFromJobMethod(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Create a procedure
 *
 * @remarks
 * Upsert procedure
 *
 * @mcp
 */
export const upsertProcedureCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    version: z.number().min(0),
    processId: z.string().optional(),
    content: z.string().optional(),
    copyFromId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProcedure(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a procedure
 *
 * @remarks
 * Upsert procedure
 *
 * @mcp
 */
export const upsertProcedureUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      version: z.number().min(0),
      processId: z.string().optional(),
      content: z.string().optional(),
      copyFromId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProcedure(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a procedure step
 *
 * @remarks
 * Upsert procedure step
 *
 * @mcp
 */
export const upsertProcedureStepCreateTool = defineServiceFn({
  input: z.looseObject({
    procedureId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().min(0).optional(),
    maxValue: z.number().min(0).optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProcedureStep(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a procedure step
 *
 * @remarks
 * Upsert procedure step
 *
 * @mcp
 */
export const upsertProcedureStepUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      procedureId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().min(0).optional(),
      maxValue: z.number().min(0).optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProcedureStep(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a procedure parameter
 *
 * @remarks
 * Upsert procedure parameter
 *
 * @mcp
 */
export const upsertProcedureParameterCreateTool = defineServiceFn({
  input: z.looseObject({
    procedureId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProcedureParameter(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a procedure parameter
 *
 * @remarks
 * Upsert procedure parameter
 *
 * @mcp
 */
export const upsertProcedureParameterUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      procedureId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProcedureParameter(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a scrap reason
 *
 * @remarks
 * Upsert scrap reason
 *
 * @mcp
 */
export const upsertScrapReasonCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertScrapReason(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a scrap reason
 *
 * @remarks
 * Upsert scrap reason
 *
 * @mcp
 */
export const upsertScrapReasonUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertScrapReason(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a failure mode
 *
 * @remarks
 * Upsert failure mode
 *
 * @mcp
 */
export const upsertFailureModeCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertFailureMode(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a failure mode
 *
 * @remarks
 * Upsert failure mode
 *
 * @mcp
 */
export const upsertFailureModeUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertFailureMode(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a maintenance dispatch comment
 *
 * @remarks
 * Upsert maintenance dispatch comment
 *
 * @mcp
 */
export const upsertMaintenanceDispatchCommentCreateTool = defineServiceFn({
  input: z.looseObject({
    maintenanceDispatchId: z.string().min(1),
    comment: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceDispatchComment(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a maintenance dispatch comment
 *
 * @remarks
 * Upsert maintenance dispatch comment
 *
 * @mcp
 */
export const upsertMaintenanceDispatchCommentUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      comment: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceDispatchComment(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a maintenance dispatch event
 *
 * @remarks
 * Upsert maintenance dispatch event
 *
 * @mcp
 */
export const upsertMaintenanceDispatchEventCreateTool = defineServiceFn({
  input: z.looseObject({
    maintenanceDispatchId: z.string().min(1),
    employeeId: z.string().min(1),
    workCenterId: z.string().min(1),
    startTime: z.string().min(1),
    endTime: z.string().optional(),
    notes: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceDispatchEvent(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a maintenance dispatch event
 *
 * @remarks
 * Upsert maintenance dispatch event
 *
 * @mcp
 */
export const upsertMaintenanceDispatchEventUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      employeeId: z.string().min(1),
      workCenterId: z.string().min(1),
      startTime: z.string().min(1),
      endTime: z.string().optional(),
      notes: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceDispatchEvent(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a maintenance dispatch item
 *
 * @remarks
 * Upsert maintenance dispatch item
 *
 * @mcp
 */
export const upsertMaintenanceDispatchItemCreateTool = defineServiceFn({
  input: z.looseObject({
    maintenanceDispatchId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: z.number().min(1),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceDispatchItem(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a maintenance dispatch item
 *
 * @remarks
 * Upsert maintenance dispatch item
 *
 * @mcp
 */
export const upsertMaintenanceDispatchItemUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      itemId: z.string().min(1),
      quantity: z.number().min(1),
      unitOfMeasureCode: z.string().min(1),
      unitCost: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceDispatchItem(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a maintenance schedule
 *
 * @remarks
 * Upsert maintenance schedule
 *
 * @mcp
 */
export const upsertMaintenanceScheduleCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    description: z.string().optional(),
    workCenterId: z.string().min(1),
    frequency: z.enum(["Daily", "Weekly", "Monthly", "Quarterly", "Annual"]),
    priority: z.enum(["Low", "Medium", "High", "Critical"]),
    estimatedDuration: z.number().optional(),
    active: z.boolean().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceSchedule(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a maintenance schedule
 *
 * @remarks
 * Upsert maintenance schedule
 *
 * @mcp
 */
export const upsertMaintenanceScheduleUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      description: z.string().optional(),
      workCenterId: z.string().min(1),
      frequency: z.enum(["Daily", "Weekly", "Monthly", "Quarterly", "Annual"]),
      priority: z.enum(["Low", "Medium", "High", "Critical"]),
      estimatedDuration: z.number().optional(),
      active: z.boolean().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaintenanceSchedule(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Get people assignments
 *
 * @mcp read
 */
export const getPeopleAssignmentsTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string(), date: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPeopleAssignments(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get people absences
 *
 * @mcp read
 */
export const getPeopleAbsencesTool = defineServiceFn({
  input: z.looseObject({ date: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPeopleAbsences(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.date as never
      )
    );
  }
});

/**
 * Get people assignments range
 *
 * @mcp read
 */
export const getPeopleAssignmentsRangeTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    startDate: z.string(),
    endDate: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPeopleAssignmentsRange(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get people absences range
 *
 * @mcp read
 */
export const getPeopleAbsencesRangeTool = defineServiceFn({
  input: z.looseObject({ startDate: z.string(), endDate: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPeopleAbsencesRange(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Open job-operation hours per work center for the capacity view
 *
 * @mcp read
 */
export const getPeopleCapacityOperationsTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    startDate: z.string().nullable(),
    endDate: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPeopleCapacityOperations(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * The `workCenterShift` links (rung 1 of the availability ladder) for a set of work centers, in ONE `.in()` query
 *
 * @mcp read
 */
export const getWorkCenterShiftsTool = defineServiceFn({
  input: z.looseObject({ workCenterIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWorkCenterShifts(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.workCenterIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * WorkCenter-kind reservations overlapping a window — the Capacity view's Scheduled series
 *
 * @mcp read
 */
export const getWorkCenterReservationsRangeTool = defineServiceFn({
  input: z.looseObject({ startAt: z.string(), endAt: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWorkCenterReservationsRange(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get location employees
 *
 * @mcp read
 */
export const getLocationEmployeesTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLocationEmployees(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Gated abilities per work center at a location, for the people board's advisory qualification badge
 *
 * @mcp read
 */
export const getWorkCenterRequiredAbilitiesTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWorkCenterRequiredAbilities(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get active employee abilities
 *
 * @mcp read
 */
export const getActiveEmployeeAbilitiesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return envelope(
      ctx,
      await getActiveEmployeeAbilities(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Reactive replanning: notify that a scheduling INPUT changed (shift, qualification, work center, location)
 *
 * @mcp
 */
export const notifyScheduleInputsChangedTool = defineServiceFn({
  input: z.looseObject({
    kind: z.enum([
      "ability",
      "shift",
      "employee-shift",
      "work-center",
      "location",
      "reorder",
      "people"
    ]),
    reason: z.string(),
    entityId: z.string().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await notifyScheduleInputsChanged(
        ctx.company.id,
        input.kind as never,
        input.reason as never,
        input.entityId as never
      )
    );
  }
});

/**
 * Get unbatched batchable operation count
 *
 * @mcp read
 */
export const getUnbatchedBatchableOperationCountTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return envelope(
      ctx,
      await getUnbatchedBatchableOperationCount(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job operation batches
 *
 * @mcp read
 */
export const getJobOperationBatchesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getJobOperationBatches(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job operation batch member stats
 *
 * @mcp read
 */
export const getJobOperationBatchMemberStatsTool = defineServiceFn({
  input: z.looseObject({ batchIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobOperationBatchMemberStats(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.batchIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get job operation batch members
 *
 * @mcp read
 */
export const getJobOperationBatchMembersTool = defineServiceFn({
  input: z.looseObject({ batchIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobOperationBatchMembers(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.batchIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get batch output lots
 *
 * @mcp read
 */
export const getBatchOutputLotsTool = defineServiceFn({
  input: z.looseObject({ batchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getBatchOutputLots(
        ctx.asCaller.supabase,
        input.batchId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job operation batch with members
 *
 * @mcp read
 */
export const getJobOperationBatchWithMembersTool = defineServiceFn({
  input: z.looseObject({ batchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobOperationBatchWithMembers(
        ctx.asCaller.supabase,
        input.batchId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job operation batch events
 *
 * @mcp read
 */
export const getJobOperationBatchEventsTool = defineServiceFn({
  input: z.looseObject({ batchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJobOperationBatchEvents(
        ctx.asCaller.supabase,
        input.batchId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get batchable operations
 *
 * @mcp read
 */
export const getBatchableOperationsTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string(), processId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getBatchableOperations(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get batchable processes
 *
 * @mcp read
 */
export const getBatchableProcessesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return envelope(
      ctx,
      await getBatchableProcesses(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get assembly instruction
 *
 * @mcp read
 */
export const getAssemblyInstructionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyInstruction(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get assembly instructions
 *
 * @mcp read
 */
export const getAssemblyInstructionsTool = defineServiceFn({
  input: z.looseObject({
    search: z.string().optional(),
    status: z.enum(["Draft", "Published", "Archived"]).optional(),
    itemId: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getAssemblyInstructions(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get assembly instructions for item
 *
 * @mcp read
 */
export const getAssemblyInstructionsForItemTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyInstructionsForItem(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get assembly instruction steps
 *
 * @mcp read
 */
export const getAssemblyInstructionStepsTool = defineServiceFn({
  input: z.looseObject({ assemblyInstructionId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyInstructionSteps(
        ctx.asCaller.supabase,
        input.assemblyInstructionId as never
      )
    );
  }
});

/**
 * Upsert assembly instruction
 *
 * @mcp
 */
export const upsertAssemblyInstructionTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    modelUploadId: z.string(),
    itemId: z.string().nullable().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAssemblyInstruction(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update assembly instruction status
 *
 * @mcp
 */
export const updateAssemblyInstructionStatusTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({ status: z.enum(["Draft", "Published", "Archived"]) })
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateAssemblyInstructionStatus(
        ctx.asCaller.supabase,
        input.id as never,
        stamp(ctx, input.data, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Sibling versions of an instruction, for the header's version switcher
 *
 * @mcp read
 */
export const getAssemblyInstructionVersionsTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    rootInstructionId: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyInstructionVersions(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a new editable Draft version as a perfect copy of an existing instruction: a fresh assemblyInstruction row (new id, version = max+1, status Draft) plus…
 *
 * @mcp
 */
export const copyAssemblyInstructionAsVersionTool = defineServiceFn({
  input: z.looseObject({ copyFromId: z.string() }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await copyAssemblyInstructionAsVersion(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Make a version the active (Published) one: archive whichever sibling is currently Published, publish the target, and repoint in-flight work to it — but only ac…
 *
 * @mcp
 */
export const activateAssemblyInstructionVersionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await activateAssemblyInstructionVersion(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Delete assembly instruction
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAssemblyInstruction(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Upsert assembly instruction step
 *
 * @mcp
 */
export const upsertAssemblyInstructionStepTool = defineServiceFn({
  input: z.looseObject({
    data: z.looseObject({
      title: z.string().nullable().optional(),
      type: z
        .enum([
          "Value",
          "Measurement",
          "Checkbox",
          "Timestamp",
          "Person",
          "List",
          "File",
          "Task",
          "Inspection"
        ])
        .optional(),
      description: z.unknown().optional(),
      required: z.boolean().optional(),
      unitOfMeasureCode: z.string().nullable().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
      listValues: z.array(z.string()).nullable().optional(),
      componentNodeIds: z.array(z.string()).optional(),
      motion: z
        .union([
          z.looseObject({
            type: z.literal("linear"),
            direction: z.tuple([z.number(), z.number(), z.number()]),
            distance: z.number().gt(0)
          }),
          z.looseObject({
            type: z.literal("L"),
            segments: z
              .array(
                z.looseObject({
                  direction: z.tuple([z.number(), z.number(), z.number()]),
                  distance: z.number().gt(0)
                })
              )
              .min(2)
          }),
          z.looseObject({
            type: z.literal("helix"),
            axis: z.tuple([z.number(), z.number(), z.number()]),
            origin: z.tuple([z.number(), z.number(), z.number()]),
            pitch: z.number().gt(0),
            turns: z.number().gt(0),
            approach: z.number().min(0)
          }),
          z.looseObject({
            type: z.literal("path"),
            keyframes: z
              .array(
                z.looseObject({
                  t: z.number().min(0).max(1),
                  position: z.tuple([z.number(), z.number(), z.number()]),
                  quaternion: z.tuple([
                    z.number(),
                    z.number(),
                    z.number(),
                    z.number()
                  ])
                })
              )
              .min(2)
          }),
          z.looseObject({
            type: z.literal("waypoints"),
            waypoints: z
              .array(
                z.looseObject({
                  offset: z.tuple([z.number(), z.number(), z.number()]),
                  rotation: z.tuple([
                    z.number(),
                    z.number(),
                    z.number(),
                    z.number()
                  ])
                })
              )
              .min(2)
          }),
          z.looseObject({ type: z.literal("none") })
        ])
        .optional(),
      camera: z
        .union([
          z.looseObject({
            position: z.tuple([z.number(), z.number(), z.number()]),
            target: z.tuple([z.number(), z.number(), z.number()]),
            fov: z.number().gt(0)
          }),
          z.looseObject({
            source: z.literal("plan"),
            direction: z.tuple([z.number(), z.number(), z.number()])
          })
        ])
        .nullable()
        .optional(),
      fastener: z
        .looseObject({
          spec: z.string().optional(),
          count: z.number().int().gt(0).optional(),
          torqueNm: z.number().gt(0).optional(),
          tool: z.string().optional()
        })
        .nullable()
        .optional(),
      durationSeconds: z.number().nullable().optional(),
      id: z.string().optional(),
      assemblyInstructionId: z.string(),
      sortOrder: z.number().optional()
    })
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAssemblyInstructionStep(
        ctx.asCaller.supabase,
        stamp(ctx, input.data, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Partial update of a step's viewer-authored motion path and/or camera pose
 *
 * @mcp
 */
export const updateAssemblyStepMotionTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    motion: z
      .union([
        z.looseObject({
          type: z.literal("linear"),
          direction: z.tuple([z.number(), z.number(), z.number()]),
          distance: z.number().gt(0)
        }),
        z.looseObject({
          type: z.literal("L"),
          segments: z
            .array(
              z.looseObject({
                direction: z.tuple([z.number(), z.number(), z.number()]),
                distance: z.number().gt(0)
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("helix"),
          axis: z.tuple([z.number(), z.number(), z.number()]),
          origin: z.tuple([z.number(), z.number(), z.number()]),
          pitch: z.number().gt(0),
          turns: z.number().gt(0),
          approach: z.number().min(0)
        }),
        z.looseObject({
          type: z.literal("path"),
          keyframes: z
            .array(
              z.looseObject({
                t: z.number().min(0).max(1),
                position: z.tuple([z.number(), z.number(), z.number()]),
                quaternion: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("waypoints"),
          waypoints: z
            .array(
              z.looseObject({
                offset: z.tuple([z.number(), z.number(), z.number()]),
                rotation: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({ type: z.literal("none") })
      ])
      .optional(),
    camera: z
      .union([
        z.looseObject({
          position: z.tuple([z.number(), z.number(), z.number()]),
          target: z.tuple([z.number(), z.number(), z.number()]),
          fov: z.number().gt(0)
        }),
        z.looseObject({
          source: z.literal("plan"),
          direction: z.tuple([z.number(), z.number(), z.number()])
        })
      ])
      .nullable()
      .optional(),
    orientation: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .nullable()
      .optional(),
    reset: z.boolean().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateAssemblyStepMotion(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update assembly step hidden components
 *
 * @mcp
 */
export const updateAssemblyStepHiddenComponentsTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    assemblyInstructionId: z.string(),
    hiddenComponentNodeIds: z.array(z.string())
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateAssemblyStepHiddenComponents(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Wrap a top-level step into a new sub-assembly; the step becomes its first step
 *
 * @mcp
 */
export const makeAssemblySubAssemblyTool = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    stepId: z.string()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await makeAssemblySubAssembly(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Add a step at the end of the instruction, or at the end of the sub-assembly `parentStepId` names (directly before its header)
 *
 * @mcp
 */
export const insertAssemblyInstructionStepTool = defineServiceFn({
  input: z.looseObject({
    title: z.string().nullable().optional(),
    type: z
      .enum([
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Task",
        "Inspection"
      ])
      .optional(),
    description: z.unknown().optional(),
    required: z.boolean().optional(),
    unitOfMeasureCode: z.string().nullable().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).nullable().optional(),
    componentNodeIds: z.array(z.string()).optional(),
    motion: z
      .union([
        z.looseObject({
          type: z.literal("linear"),
          direction: z.tuple([z.number(), z.number(), z.number()]),
          distance: z.number().gt(0)
        }),
        z.looseObject({
          type: z.literal("L"),
          segments: z
            .array(
              z.looseObject({
                direction: z.tuple([z.number(), z.number(), z.number()]),
                distance: z.number().gt(0)
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("helix"),
          axis: z.tuple([z.number(), z.number(), z.number()]),
          origin: z.tuple([z.number(), z.number(), z.number()]),
          pitch: z.number().gt(0),
          turns: z.number().gt(0),
          approach: z.number().min(0)
        }),
        z.looseObject({
          type: z.literal("path"),
          keyframes: z
            .array(
              z.looseObject({
                t: z.number().min(0).max(1),
                position: z.tuple([z.number(), z.number(), z.number()]),
                quaternion: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("waypoints"),
          waypoints: z
            .array(
              z.looseObject({
                offset: z.tuple([z.number(), z.number(), z.number()]),
                rotation: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({ type: z.literal("none") })
      ])
      .optional(),
    camera: z
      .union([
        z.looseObject({
          position: z.tuple([z.number(), z.number(), z.number()]),
          target: z.tuple([z.number(), z.number(), z.number()]),
          fov: z.number().gt(0)
        }),
        z.looseObject({
          source: z.literal("plan"),
          direction: z.tuple([z.number(), z.number(), z.number()])
        })
      ])
      .nullable()
      .optional(),
    fastener: z
      .looseObject({
        spec: z.string().optional(),
        count: z.number().int().gt(0).optional(),
        torqueNm: z.number().gt(0).optional(),
        tool: z.string().optional()
      })
      .nullable()
      .optional(),
    durationSeconds: z.number().nullable().optional(),
    assemblyInstructionId: z.string(),
    parentStepId: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await insertAssemblyInstructionStep(
        ctx.asSystem.pg,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Rename a sub-assembly and/or set the step that uses it (`null` = it joins the main build)
 *
 * @mcp
 */
export const updateAssemblySubAssemblyTool = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    headerId: z.string(),
    title: z.string().optional(),
    usedInStepId: z.string().nullable().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateAssemblySubAssembly(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Remove the sub-assembly but keep its steps: they return to the top level in place
 *
 * @mcp destructive
 */
export const ungroupAssemblySubAssemblyTool = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    headerId: z.string()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await ungroupAssemblySubAssembly(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Delete a sub-assembly together with its steps
 *
 * @mcp destructive
 */
export const deleteAssemblySubAssemblyTool = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    headerId: z.string()
  }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await deleteAssemblySubAssembly(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Update assembly instruction step status
 *
 * @mcp
 */
export const updateAssemblyInstructionStepStatusTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({ status: z.enum(["Todo", "Review", "Done"]) })
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateAssemblyInstructionStepStatus(
        ctx.asCaller.supabase,
        input.id as never,
        stamp(ctx, input.data, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Drag-sort of the step list: each step's new position and sub-assembly (`parentStepId`, `null` = top level; omitted = unchanged)
 *
 * @mcp
 */
export const updateAssemblyInstructionStepOrderTool = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    updates: z.array(
      z.looseObject({
        id: z.string(),
        sortOrder: z.number(),
        parentStepId: z.string().nullable().optional()
      })
    )
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateAssemblyInstructionStepOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.assemblyInstructionId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete assembly instruction step
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStepTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAssemblyInstructionStep(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly instruction step slides
 *
 * @mcp read
 */
export const getAssemblyInstructionStepSlidesTool = defineServiceFn({
  input: z.looseObject({ stepIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyInstructionStepSlides(
        ctx.asCaller.supabase,
        stamp(ctx, input.stepIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a assembly instruction step slide
 *
 * @remarks
 * Upsert assembly instruction step slide
 *
 * @mcp
 */
export const upsertAssemblyInstructionStepSlideCreateTool = defineServiceFn({
  input: z.looseObject({
    stepId: z.string().min(1),
    imagePath: z.string().optional(),
    modelUploadId: z.string().optional(),
    caption: z.string().optional(),
    sortOrder: z.number().min(0).optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
    annotations: z
      .array(
        z.looseObject({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          label: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
          toolId: z.string().nullable().optional()
        })
      )
      .nullable()
      .optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAssemblyInstructionStepSlide(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a assembly instruction step slide
 *
 * @remarks
 * Upsert assembly instruction step slide
 *
 * @mcp
 */
export const upsertAssemblyInstructionStepSlideUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      stepId: z.string().min(1),
      imagePath: z.string().optional(),
      modelUploadId: z.string().optional(),
      caption: z.string().optional(),
      sortOrder: z.number().min(0).optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
      annotations: z
        .array(
          z.looseObject({
            id: z.string(),
            x: z.number(),
            y: z.number(),
            label: z.string().nullable().optional(),
            color: z.string().nullable().optional(),
            toolId: z.string().nullable().optional()
          })
        )
        .nullable()
        .optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAssemblyInstructionStepSlide(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete assembly instruction step slide
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStepSlideTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAssemblyInstructionStepSlide(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly instruction step tools
 *
 * @mcp read
 */
export const getAssemblyInstructionStepToolsTool = defineServiceFn({
  input: z.looseObject({ stepIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyInstructionStepTools(
        ctx.asCaller.supabase,
        stamp(ctx, input.stepIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Upsert assembly instruction step tool
 *
 * @mcp
 */
export const upsertAssemblyInstructionStepToolTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    stepId: z.string(),
    itemId: z.string(),
    quantity: z.number().optional(),
    sortOrder: z.number().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAssemblyInstructionStepToolRow(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete assembly instruction step tool
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStepToolTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAssemblyInstructionStepToolRow(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly instruction step materials
 *
 * @mcp read
 */
export const getAssemblyInstructionStepMaterialsTool = defineServiceFn({
  input: z.looseObject({ stepIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyInstructionStepMaterials(
        ctx.asCaller.supabase,
        stamp(ctx, input.stepIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Upsert assembly instruction step material
 *
 * @mcp
 */
export const upsertAssemblyInstructionStepMaterialTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    stepId: z.string(),
    itemId: z.string(),
    quantity: z.number().nullable().optional(),
    sortOrder: z.number().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAssemblyInstructionStepMaterial(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update assembly instruction step material order
 *
 * @mcp
 */
export const updateAssemblyInstructionStepMaterialOrderTool = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateAssemblyInstructionStepMaterialOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.assemblyInstructionId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete assembly instruction step material
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStepMaterialTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAssemblyInstructionStepMaterial(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly units
 *
 * @mcp read
 */
export const getAssemblyUnitsTool = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyUnits(
        ctx.asCaller.supabase,
        input.modelUploadId as never
      )
    );
  }
});

/**
 * Upsert assembly unit
 *
 * @mcp
 */
export const upsertAssemblyUnitTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    modelUploadId: z.string(),
    name: z.string(),
    componentNodeIds: z.array(z.string()),
    itemId: z.string().nullable().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAssemblyUnit(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete assembly unit
 *
 * @mcp destructive
 */
export const deleteAssemblyUnitTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAssemblyUnit(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Latest plan job in any state — used to tell "planning is running" apart from "planning failed" and to avoid enqueueing duplicate plan runs
 *
 * @mcp read
 */
export const getLatestAssemblyPlanJobTool = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLatestAssemblyPlanJob(
        ctx.asCaller.supabase,
        input.modelUploadId as never
      )
    );
  }
});

/**
 * Downloads and parses plan.json for a model's latest successful plan
 *
 * @mcp read
 */
export const getAssemblyPlanJsonTool = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getAssemblyPlanJson(
        ctx.asCaller.supabase,
        input.modelUploadId as never
      )
    );
  }
});

/**
 * Mappings from distinct model components (geometry hashes) to BOM items
 *
 * @mcp read
 */
export const getAssemblyComponentMappingsTool = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssemblyComponentMappings(
        ctx.asCaller.supabase,
        input.modelUploadId as never
      )
    );
  }
});

/**
 * Delete assembly component mapping
 *
 * @mcp destructive
 */
export const deleteAssemblyComponentMappingTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAssemblyComponentMapping(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * The engineering bill of materials for a made item, flattened through its Make subassemblies (makeMethod → methodMaterial → materialMakeMethodId), with quantiti…
 *
 * @mcp read
 */
export const getFlattenedBomMaterialsTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getFlattenedBomMaterials(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Maps a DB step row to the viewer's step shape
 *
 * @mcp
 */
export const toViewerStepTool = defineServiceFn({
  input: z.looseObject({
    step: z.looseObject({
      assemblyInstructionId: z.string(),
      buildWave: z.number().nullable(),
      camera: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable(),
      companyId: z.string(),
      componentNodeIds: z.array(z.string()),
      createdAt: z.string(),
      createdBy: z.string(),
      description: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable(),
      durationSeconds: z.number().nullable(),
      explode: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable(),
      fastener: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable(),
      fileTypes: z.array(z.string()).nullable(),
      hiddenComponentNodeIds: z.array(z.string()),
      id: z.string(),
      instructionText: z.string().nullable(),
      isSubAssembly: z.boolean(),
      listValues: z.array(z.string()).nullable(),
      maxValue: z.number().nullable(),
      minValue: z.number().nullable(),
      motion: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable(),
      notes: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable(),
      orientation: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable(),
      parentStepId: z.string().nullable(),
      planConfidence: z.string(),
      required: z.boolean().nullable(),
      rootStepId: z.string().nullable(),
      sortOrder: z.number(),
      status: z.enum(["Todo", "Review", "Done"]),
      title: z.string().nullable(),
      type: z.enum([
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Task",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().nullable(),
      updatedAt: z.string().nullable(),
      updatedBy: z.string().nullable(),
      usedInStepId: z.string().nullable(),
      warnings: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(
                  z
                    .union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.record(z.string(), z.unknown()),
                      z.array(z.unknown())
                    ])
                    .nullable()
                )
              ])
              .nullable()
          )
        ])
        .nullable()
    })
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return plain(
      ctx,
      await toViewerStep(stamp(ctx, input.step, ["companyId"]) as never)
    );
  }
});

/**
 * Create a presigned upload URL for a job document
 *
 * @mcp
 */
export const createJobDocumentUploadUrlTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string(), name: z.string() }),
  permission: { create: "production" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createJobDocumentUploadUrl(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});
