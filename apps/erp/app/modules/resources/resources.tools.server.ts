// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The resources module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in resources.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  envelopes,
  paged,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  activateProcess,
  deleteContractor,
  deleteFailureMode,
  deleteLocation,
  deleteMaintenanceDispatch,
  deleteMaintenanceSchedule,
  deletePartner,
  deleteProcess,
  deleteShift,
  deleteSuggestion,
  deleteTraining,
  deleteTrainingAssignment,
  deleteTrainingQuestion,
  getAbilities,
  getAbilitiesList,
  getAbility,
  getContractor,
  getContractors,
  getEmployeeAbilities,
  getEmployeeAbility,
  getFailureMode,
  getFailureModes,
  getFailureModesList,
  getLocation,
  getLocations,
  getLocationsList,
  getMaintenanceDispatch,
  getMaintenanceDispatchComments,
  getMaintenanceDispatchEvents,
  getMaintenanceDispatchesByLocation,
  getMaintenanceDispatchItems,
  getMaintenanceSchedule,
  getMaintenanceSchedulesByLocation,
  getOutstandingTrainingsForUser,
  getPartner,
  getPartnerBySupplierId,
  getPartners,
  getProcess,
  getProcesses,
  getProcessesList,
  getProcessesWithoutAbility,
  getSuggestion,
  getSuggestions,
  getTraining,
  getTrainingAssignment,
  getTrainingAssignmentForCompletion,
  getTrainingAssignmentStatus,
  getTrainingAssignmentStatusForEmployee,
  getTrainingAssignmentSummary,
  getTrainingAssignments,
  getTrainings,
  getTrainingsList,
  getWorkCenter,
  getWorkCenters,
  getWorkCentersByLocation,
  getWorkCentersList,
  getWorkCentersListWithBlockingStatus,
  processDeactivate,
  updateAbility,
  updateSuggestionEmoji,
  updateTrainingQuestionOrder,
  upsertContractor,
  upsertFailureMode,
  upsertMaintenanceDispatchComment,
  upsertMaintenanceDispatchItem,
  upsertPartner,
  upsertTraining,
  upsertTrainingQuestion
} from "./resources.service";

/**
 * Delete contractor
 *
 * @mcp destructive
 */
export const deleteContractorTool = defineServiceFn({
  input: z.looseObject({ contractorId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteContractor(ctx.asCaller.supabase, input.contractorId as never)
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
  permission: { delete: "resources" },
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
 * Delete location
 *
 * @mcp destructive
 */
export const deleteLocationTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteLocation(ctx.asCaller.supabase, input.locationId as never)
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
  permission: { delete: "resources" },
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
 * Delete maintenance schedule
 *
 * @mcp destructive
 */
export const deleteMaintenanceScheduleTool = defineServiceFn({
  input: z.looseObject({ scheduleId: z.string() }),
  permission: { delete: "resources" },
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
 * Delete partner
 *
 * @mcp destructive
 */
export const deletePartnerTool = defineServiceFn({
  input: z.looseObject({ partnerId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePartner(ctx.asCaller.supabase, input.partnerId as never)
    );
  }
});

/**
 * Activate process
 *
 * @mcp
 */
export const activateProcessTool = defineServiceFn({
  input: z.looseObject({ processId: z.string() }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await activateProcess(ctx.asCaller.supabase, input.processId as never)
    );
  }
});

/**
 * Process deactivate
 *
 * @mcp
 */
export const processDeactivateTool = defineServiceFn({
  input: z.looseObject({ processId: z.string() }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await processDeactivate(ctx.asCaller.supabase, input.processId as never)
    );
  }
});

/**
 * Delete process
 *
 * @mcp destructive
 */
export const deleteProcessTool = defineServiceFn({
  input: z.looseObject({ processId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteProcess(ctx.asCaller.supabase, input.processId as never)
    );
  }
});

/**
 * Delete shift
 *
 * @mcp destructive
 */
export const deleteShiftTool = defineServiceFn({
  input: z.looseObject({ shiftId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteShift(ctx.asCaller.supabase, input.shiftId as never)
    );
  }
});

/**
 * Delete suggestion
 *
 * @mcp destructive
 */
export const deleteSuggestionTool = defineServiceFn({
  input: z.looseObject({ suggestionId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSuggestion(ctx.asCaller.supabase, input.suggestionId as never)
    );
  }
});

/**
 * Delete training
 *
 * @mcp destructive
 */
export const deleteTrainingTool = defineServiceFn({
  input: z.looseObject({ trainingId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteTraining(ctx.asCaller.supabase, input.trainingId as never)
    );
  }
});

/**
 * Delete training assignment
 *
 * @mcp destructive
 */
export const deleteTrainingAssignmentTool = defineServiceFn({
  input: z.looseObject({ assignmentId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteTrainingAssignment(
        ctx.asCaller.supabase,
        input.assignmentId as never
      )
    );
  }
});

/**
 * Delete training question
 *
 * @mcp destructive
 */
export const deleteTrainingQuestionTool = defineServiceFn({
  input: z.looseObject({ trainingQuestionId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteTrainingQuestion(
        ctx.asCaller.supabase,
        input.trainingQuestionId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get abilities
 *
 * @mcp read
 */
export const getAbilitiesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getAbilities(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get abilities list
 *
 * @mcp read
 */
export const getAbilitiesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getAbilitiesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get ability
 *
 * @mcp read
 */
export const getAbilityTool = defineServiceFn({
  input: z.looseObject({ abilityId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAbility(ctx.asCaller.supabase, input.abilityId as never)
    );
  }
});

/**
 * Get contractor
 *
 * @mcp read
 */
export const getContractorTool = defineServiceFn({
  input: z.looseObject({ contractorId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getContractor(ctx.asCaller.supabase, input.contractorId as never)
    );
  }
});

/**
 * Get contractors
 *
 * @mcp read
 */
export const getContractorsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getContractors(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get employee abilities
 *
 * @mcp read
 */
export const getEmployeeAbilitiesTool = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEmployeeAbilities(
        ctx.asCaller.supabase,
        input.employeeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get employee ability
 *
 * @mcp read
 */
export const getEmployeeAbilityTool = defineServiceFn({
  input: z.looseObject({ employeeAbilityId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEmployeeAbility(
        ctx.asCaller.supabase,
        input.employeeAbilityId as never
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
  permission: { view: "resources" },
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
  permission: { view: "resources" },
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
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getFailureModesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get location
 *
 * @mcp read
 */
export const getLocationTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLocation(ctx.asCaller.supabase, input.locationId as never)
    );
  }
});

/**
 * Get locations
 *
 * @mcp read
 */
export const getLocationsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getLocations(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get locations list
 *
 * @mcp read
 */
export const getLocationsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getLocationsList(ctx.asCaller.supabase, ctx.company.id)
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
  permission: { view: "resources" },
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
  permission: { view: "resources" },
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
  permission: { view: "resources" },
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
  permission: { view: "resources" },
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
 * Get maintenance dispatches by location
 *
 * @mcp read
 */
export const getMaintenanceDispatchesByLocationTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional(),
      status: z.string().optional()
    })
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaintenanceDispatchesByLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        stamp(ctx, input, ["companyId"]) as never
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
  permission: { view: "resources" },
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
 * Get maintenance schedules by location
 *
 * @mcp read
 */
export const getMaintenanceSchedulesByLocationTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional(),
      active: z.boolean().optional()
    })
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaintenanceSchedulesByLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get outstanding trainings for user
 *
 * @mcp read
 */
export const getOutstandingTrainingsForUserTool = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOutstandingTrainingsForUser(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.employeeId as never
      )
    );
  }
});

/**
 * Get training assignment status for employee
 *
 * @mcp read
 */
export const getTrainingAssignmentStatusForEmployeeTool = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrainingAssignmentStatusForEmployee(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.employeeId as never
      )
    );
  }
});

/**
 * Get partner
 *
 * @mcp read
 */
export const getPartnerTool = defineServiceFn({
  input: z.looseObject({ partnerId: z.string(), abilityId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPartner(
        ctx.asCaller.supabase,
        input.partnerId as never,
        input.abilityId as never
      )
    );
  }
});

/**
 * Get partner by supplier id
 *
 * @mcp read
 */
export const getPartnerBySupplierIdTool = defineServiceFn({
  input: z.looseObject({ partnerId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPartnerBySupplierId(
        ctx.asCaller.supabase,
        input.partnerId as never
      )
    );
  }
});

/**
 * Get partners
 *
 * @mcp read
 */
export const getPartnersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPartners(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get process
 *
 * @mcp read
 */
export const getProcessTool = defineServiceFn({
  input: z.looseObject({ processId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getProcess(ctx.asCaller.supabase, input.processId as never)
    );
  }
});

/**
 * Get processes
 *
 * @mcp read
 */
export const getProcessesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getProcesses(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get processes list
 *
 * @mcp read
 */
export const getProcessesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getProcessesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get suggestion
 *
 * @mcp read
 */
export const getSuggestionTool = defineServiceFn({
  input: z.looseObject({ suggestionId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSuggestion(ctx.asCaller.supabase, input.suggestionId as never)
    );
  }
});

/**
 * Get suggestions
 *
 * @mcp read
 */
export const getSuggestionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSuggestions(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get training
 *
 * @mcp read
 */
export const getTrainingTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTraining(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get training assignment
 *
 * @mcp read
 */
export const getTrainingAssignmentTool = defineServiceFn({
  input: z.looseObject({ assignmentId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrainingAssignment(
        ctx.asCaller.supabase,
        input.assignmentId as never
      )
    );
  }
});

/**
 * Get training assignment for completion
 *
 * @mcp read
 */
export const getTrainingAssignmentForCompletionTool = defineServiceFn({
  input: z.looseObject({ assignmentId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrainingAssignmentForCompletion(
        ctx.asCaller.supabase,
        input.assignmentId as never
      )
    );
  }
});

/**
 * Get training assignments
 *
 * @mcp read
 */
export const getTrainingAssignmentsTool = defineServiceFn({
  input: z.looseObject({ trainingId: z.string().optional() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrainingAssignments(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.trainingId as never
      )
    );
  }
});

/**
 * Get training assignment status
 *
 * @mcp read
 */
export const getTrainingAssignmentStatusTool = defineServiceFn({
  input: z.looseObject({
    trainingId: z.string().optional(),
    trainingAssignmentId: z.string().optional(),
    status: z
      .enum(["Completed", "Pending", "Overdue", "Not Required"])
      .optional(),
    search: z.string().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrainingAssignmentStatus(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get training assignment summary
 *
 * @mcp read
 */
export const getTrainingAssignmentSummaryTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getTrainingAssignmentSummary(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get trainings
 *
 * @mcp read
 */
export const getTrainingsTool = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getTrainings(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get trainings list
 *
 * @mcp read
 */
export const getTrainingsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getTrainingsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get work center
 *
 * @mcp read
 */
export const getWorkCenterTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWorkCenter(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get work centers
 *
 * @mcp read
 */
export const getWorkCentersTool = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getWorkCenters(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get work centers by location
 *
 * @mcp read
 */
export const getWorkCentersByLocationTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWorkCentersByLocation(
        ctx.asCaller.supabase,
        input.locationId as never
      )
    );
  }
});

/**
 * Get work centers list
 *
 * @mcp read
 */
export const getWorkCentersListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getWorkCentersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get work centers list with blocking status
 *
 * @mcp read
 */
export const getWorkCentersListWithBlockingStatusTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getWorkCentersListWithBlockingStatus(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Processes that do not yet have an ability
 *
 * @mcp read
 */
export const getProcessesWithoutAbilityTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return envelope(
      ctx,
      await getProcessesWithoutAbility(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Update ability
 *
 * @mcp
 */
export const updateAbilityTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    ability: z.looseObject({
      name: z.string().optional(),
      recertifyEveryDays: z.number().nullable().optional()
    })
  }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateAbility(
        ctx.asCaller.supabase,
        input.id as never,
        stamp(ctx, input.ability, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update suggestion emoji
 *
 * @mcp
 */
export const updateSuggestionEmojiTool = defineServiceFn({
  input: z.looseObject({ suggestionId: z.string(), emoji: z.string() }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSuggestionEmoji(
        ctx.asCaller.supabase,
        input.suggestionId as never,
        input.emoji as never
      )
    );
  }
});

/**
 * Update training question order
 *
 * @mcp
 */
export const updateTrainingQuestionOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateTrainingQuestionOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a contractor
 *
 * @remarks
 * Upsert contractor
 *
 * @mcp destructive
 */
export const upsertContractorCreateTool = defineServiceFn({
  input: z.looseObject({
    contractorWithAbilities: z.looseObject({
      id: z
        .string()
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      hoursPerWeek: z.number().optional(),
      abilities: z.array(z.string()),
      customFields: z.unknown().optional()
    })
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertContractor(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.contractorWithAbilities,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a contractor
 *
 * @remarks
 * Upsert contractor
 *
 * @mcp destructive
 */
export const upsertContractorUpdateTool = defineServiceFn({
  input: z.looseObject({
    contractorWithAbilities: z.looseObject({
      id: z
        .string()
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      hoursPerWeek: z.number().optional(),
      abilities: z.array(z.string()),
      customFields: z.unknown().optional()
    })
  }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertContractor(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.contractorWithAbilities,
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
    type: z.enum(["Maintenance", "Quality", "Operations", "Other"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "resources" },
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
      type: z.enum(["Maintenance", "Quality", "Operations", "Other"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
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
  permission: { create: "resources" },
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
  permission: { update: "resources" },
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
  permission: { create: "resources" },
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
  permission: { update: "resources" },
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
 * Create a partner
 *
 * @remarks
 * Upsert partner
 *
 * @mcp
 */
export const upsertPartnerCreateTool = defineServiceFn({
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    hoursPerWeek: z.number().min(0),
    customFields: z.unknown().optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPartner(
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
 * Update a partner
 *
 * @remarks
 * Upsert partner
 *
 * @mcp
 */
export const upsertPartnerUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      id: z
        .string()
        .min(1)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      hoursPerWeek: z.number().min(0),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPartner(
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
 * Create a training
 *
 * @remarks
 * Upsert training
 *
 * @mcp
 */
export const upsertTrainingCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    content: z.string().optional(),
    grantsAbilityId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertTraining(
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
 * Update a training
 *
 * @remarks
 * Upsert training
 *
 * @mcp
 */
export const upsertTrainingUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      content: z.string().optional(),
      grantsAbilityId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertTraining(
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
 * Create a training question
 *
 * @remarks
 * Upsert training question
 *
 * @mcp
 */
export const upsertTrainingQuestionCreateTool = defineServiceFn({
  input: z.looseObject({
    trainingId: z.string().min(1),
    question: z.string().min(1),
    type: z.enum([
      "MultipleChoice",
      "TrueFalse",
      "MultipleAnswers",
      "MatchingPairs",
      "Numerical"
    ]),
    sortOrder: z.number().min(0).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    correctAnswers: z.union([z.string(), z.array(z.string())]).optional(),
    correctBoolean: z.union([z.boolean(), z.string()]).optional(),
    matchingPairs: z.string().optional(),
    correctNumber: z.number().optional(),
    tolerance: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertTrainingQuestion(
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
 * Update a training question
 *
 * @remarks
 * Upsert training question
 *
 * @mcp
 */
export const upsertTrainingQuestionUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      trainingId: z.string().min(1),
      question: z.string().min(1),
      type: z.enum([
        "MultipleChoice",
        "TrueFalse",
        "MultipleAnswers",
        "MatchingPairs",
        "Numerical"
      ]),
      sortOrder: z.number().min(0).optional(),
      required: z.boolean().optional(),
      options: z.array(z.string()).optional(),
      correctAnswers: z.union([z.string(), z.array(z.string())]).optional(),
      correctBoolean: z.union([z.boolean(), z.string()]).optional(),
      matchingPairs: z.string().optional(),
      correctNumber: z.number().optional(),
      tolerance: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertTrainingQuestion(
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
