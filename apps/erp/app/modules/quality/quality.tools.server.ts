// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The quality module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in quality.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  activateGauge,
  deactivateGauge,
  deleteGauge,
  deleteGaugeCalibrationRecord,
  deleteGaugeType,
  deleteInspectionDocument,
  deleteIssue,
  deleteIssueAssociation,
  deleteIssueType,
  deleteIssueWorkflow,
  deleteQualityDocument,
  deleteRequiredAction,
  deleteRisk,
  getBalloons,
  getGauge,
  getGaugeCalibrationRecord,
  getGaugeCalibrationRecords,
  getGaugeCalibrationRecordsByGaugeId,
  getGauges,
  getGaugesList,
  getGaugeType,
  getGaugeTypes,
  getGaugeTypesList,
  getInspection,
  getInspectionDocument,
  getInspectionDocuments,
  getInspectionDocumentsForItem,
  getInspectionFeatures,
  getInspectionGauges,
  getInspectionMeasurements,
  getInspectionPlan,
  getInspectionSamplingPlans,
  getInspections,
  getInspectionTrackedEntities,
  getIssue,
  getIssueActionTasks,
  getIssueApprovalTasks,
  getIssueAssociations,
  getIssueFromExternalLink,
  getIssueItems,
  getIssueReviewers,
  getIssueSuppliers,
  getIssues,
  getIssueType,
  getIssueTypeByName,
  getIssueTypes,
  getIssueTypesList,
  getIssueWorkflow,
  getIssueWorkflows,
  getIssueWorkflowsList,
  getItemInspectionDocumentAssignments,
  getQualityActions,
  getQualityDocument,
  getQualityDocuments,
  getQualityDocumentVersions,
  getQualityFiles,
  getReceiptInspections,
  getRequiredAction,
  getRequiredActions,
  getRequiredActionsList,
  getRisk,
  getRisks,
  insertGauge,
  insertIssue,
  insertIssueReviewer,
  saveInspectionDocumentAtomic,
  updateGauge,
  updateInspectionDocumentSampling,
  updateIssue,
  updateIssueActionProcesses,
  upsertGaugeCalibrationRecord,
  upsertGaugeType,
  upsertInspectionDocument,
  upsertIssueType,
  upsertIssueWorkflow,
  upsertItemInspectionDocumentAssignment,
  upsertQualityDocument,
  upsertRequiredAction
} from "./quality.service";

/**
 * Activate gauge
 *
 * @mcp
 */
export const activateGaugeTool = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await activateGauge(ctx.asCaller.supabase, input.gaugeId as never)
    );
  }
});

/**
 * Deactivate gauge
 *
 * @mcp
 */
export const deactivateGaugeTool = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deactivateGauge(ctx.asCaller.supabase, input.gaugeId as never)
    );
  }
});

/**
 * Delete gauge
 *
 * @mcp destructive
 */
export const deleteGaugeTool = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteGauge(ctx.asCaller.supabase, input.gaugeId as never)
    );
  }
});

/**
 * Delete gauge calibration record
 *
 * @mcp destructive
 */
export const deleteGaugeCalibrationRecordTool = defineServiceFn({
  input: z.looseObject({ gaugeCalibrationRecordId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteGaugeCalibrationRecord(
        ctx.asCaller.supabase,
        input.gaugeCalibrationRecordId as never
      )
    );
  }
});

/**
 * Delete gauge type
 *
 * @mcp destructive
 */
export const deleteGaugeTypeTool = defineServiceFn({
  input: z.looseObject({ gaugeTypeId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteGaugeType(ctx.asCaller.supabase, input.gaugeTypeId as never)
    );
  }
});

/**
 * Delete issue
 *
 * @mcp destructive
 */
export const deleteIssueTool = defineServiceFn({
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteIssue(ctx.asCaller.supabase, input.nonConformanceId as never)
    );
  }
});

/**
 * Delete issue association
 *
 * @mcp destructive
 */
export const deleteIssueAssociationTool = defineServiceFn({
  input: z.looseObject({ type: z.string(), associationId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return plain(
      ctx,
      await deleteIssueAssociation(
        ctx.asCaller.supabase,
        input.type as never,
        input.associationId as never
      )
    );
  }
});

/**
 * Delete issue type
 *
 * @mcp destructive
 */
export const deleteIssueTypeTool = defineServiceFn({
  input: z.looseObject({ nonConformanceTypeId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteIssueType(
        ctx.asCaller.supabase,
        input.nonConformanceTypeId as never
      )
    );
  }
});

/**
 * Delete issue workflow
 *
 * @mcp destructive
 */
export const deleteIssueWorkflowTool = defineServiceFn({
  input: z.looseObject({ nonConformanceWorkflowId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteIssueWorkflow(
        ctx.asCaller.supabase,
        input.nonConformanceWorkflowId as never
      )
    );
  }
});

/**
 * Delete required action
 *
 * @mcp destructive
 */
export const deleteRequiredActionTool = defineServiceFn({
  input: z.looseObject({ requiredActionId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteRequiredAction(
        ctx.asCaller.supabase,
        input.requiredActionId as never
      )
    );
  }
});

/**
 * Delete quality document
 *
 * @mcp destructive
 */
export const deleteQualityDocumentTool = defineServiceFn({
  input: z.looseObject({ qualityDocumentId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteQualityDocument(
        ctx.asCaller.supabase,
        input.qualityDocumentId as never
      )
    );
  }
});

/**
 * Delete risk
 *
 * @mcp destructive
 */
export const deleteRiskTool = defineServiceFn({
  input: z.looseObject({ riskId: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteRisk(ctx.asCaller.supabase, input.riskId as never)
    );
  }
});

/**
 * Get issue from external link
 *
 * @mcp read
 */
export const getIssueFromExternalLinkTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueFromExternalLink(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get gauge
 *
 * @mcp read
 */
export const getGaugeTool = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getGauge(ctx.asCaller.supabase, input.gaugeId as never)
    );
  }
});

/**
 * Get gauges
 *
 * @mcp read
 */
export const getGaugesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getGauges(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get gauges list
 *
 * @mcp read
 */
export const getGaugesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return envelope(
      ctx,
      await getGaugesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get gauge calibration record
 *
 * @mcp read
 */
export const getGaugeCalibrationRecordTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getGaugeCalibrationRecord(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get gauge calibration records
 *
 * @mcp read
 */
export const getGaugeCalibrationRecordsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getGaugeCalibrationRecords(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get gauge calibration records by gauge id
 *
 * @mcp read
 */
export const getGaugeCalibrationRecordsByGaugeIdTool = defineServiceFn({
  input: z.looseObject({ gaugeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getGaugeCalibrationRecordsByGaugeId(
        ctx.asCaller.supabase,
        input.gaugeId as never
      )
    );
  }
});

/**
 * Get gauge types list
 *
 * @mcp read
 */
export const getGaugeTypesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return envelope(
      ctx,
      await getGaugeTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get gauge type
 *
 * @mcp read
 */
export const getGaugeTypeTool = defineServiceFn({
  input: z.looseObject({ gaugeTypeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getGaugeType(ctx.asCaller.supabase, input.gaugeTypeId as never)
    );
  }
});

/**
 * Get gauge types
 *
 * @mcp read
 */
export const getGaugeTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getGaugeTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get issue
 *
 * @mcp read
 */
export const getIssueTool = defineServiceFn({
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssue(ctx.asCaller.supabase, input.nonConformanceId as never)
    );
  }
});

/**
 * Get issues
 *
 * @mcp read
 */
export const getIssuesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getIssues(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get issue workflow
 *
 * @mcp read
 */
export const getIssueWorkflowTool = defineServiceFn({
  input: z.looseObject({ nonConformanceWorkflowId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueWorkflow(
        ctx.asCaller.supabase,
        input.nonConformanceWorkflowId as never
      )
    );
  }
});

/**
 * Get issue action tasks
 *
 * @mcp read
 */
export const getIssueActionTasksTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), supplierId: z.string().optional() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueActionTasks(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get issue approval tasks
 *
 * @mcp read
 */
export const getIssueApprovalTasksTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueApprovalTasks(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue items
 *
 * @mcp read
 */
export const getIssueItemsTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueItems(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue associations
 *
 * @mcp read
 */
export const getIssueAssociationsTool = defineServiceFn({
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getIssueAssociations(
        ctx.asCaller.supabase,
        input.nonConformanceId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue reviewers
 *
 * @mcp read
 */
export const getIssueReviewersTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueReviewers(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue suppliers
 *
 * @mcp read
 */
export const getIssueSuppliersTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueSuppliers(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get issue type
 *
 * @mcp read
 */
export const getIssueTypeTool = defineServiceFn({
  input: z.looseObject({ nonConformanceTypeId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueType(
        ctx.asCaller.supabase,
        input.nonConformanceTypeId as never
      )
    );
  }
});

/**
 * Get issue type by name
 *
 * @mcp read
 */
export const getIssueTypeByNameTool = defineServiceFn({
  input: z.looseObject({ name: z.string(), excludeId: z.string().optional() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIssueTypeByName(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.name as never,
        input.excludeId as never
      )
    );
  }
});

/**
 * Get issue types
 *
 * @mcp read
 */
export const getIssueTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getIssueTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get issue workflows
 *
 * @mcp read
 */
export const getIssueWorkflowsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getIssueWorkflows(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get issue workflows list
 *
 * @mcp read
 */
export const getIssueWorkflowsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return envelope(
      ctx,
      await getIssueWorkflowsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get issue types list
 *
 * @mcp read
 */
export const getIssueTypesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return envelope(
      ctx,
      await getIssueTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get quality actions
 *
 * @mcp read
 */
export const getQualityActionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getQualityActions(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get quality document
 *
 * @mcp read
 */
export const getQualityDocumentTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQualityDocument(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get quality document versions
 *
 * @mcp read
 */
export const getQualityDocumentVersionsTool = defineServiceFn({
  input: z.looseObject({ name: z.string(), version: z.number() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQualityDocumentVersions(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get quality documents
 *
 * @mcp read
 */
export const getQualityDocumentsTool = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getQualityDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get quality files
 *
 * @mcp read
 */
export const getQualityFilesTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getQualityFiles(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get required actions list
 *
 * @mcp read
 */
export const getRequiredActionsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "quality" },
  async run(ctx) {
    return envelope(
      ctx,
      await getRequiredActionsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get required actions
 *
 * @mcp read
 */
export const getRequiredActionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getRequiredActions(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get required action
 *
 * @mcp read
 */
export const getRequiredActionTool = defineServiceFn({
  input: z.looseObject({ requiredActionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRequiredAction(
        ctx.asCaller.supabase,
        input.requiredActionId as never
      )
    );
  }
});

/**
 * Get risk
 *
 * @mcp read
 */
export const getRiskTool = defineServiceFn({
  input: z.looseObject({ riskId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRisk(ctx.asCaller.supabase, input.riskId as never)
    );
  }
});

/**
 * Get risks
 *
 * @mcp read
 */
export const getRisksTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z
      .array(z.enum(["Open", "Closed", "In Review", "Mitigating", "Accepted"]))
      .nullable()
      .optional(),
    source: z
      .array(
        z.enum([
          "Customer",
          "Supplier",
          "Item",
          "Job",
          "General",
          "Quote Line",
          "Work Center"
        ])
      )
      .nullable()
      .optional(),
    assignee: z.array(z.string()).optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getRisks(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Insert issue reviewer
 *
 * @mcp
 */
export const insertIssueReviewerTool = defineServiceFn({
  input: z.looseObject({
    title: z.string().min(1),
    nonConformanceId: z.string()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertIssueReviewer(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update issue action processes
 *
 * @mcp destructive
 */
export const updateIssueActionProcessesTool = defineServiceFn({
  input: z.looseObject({
    actionTaskId: z.string(),
    processIds: z.array(z.string())
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateIssueActionProcesses(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Insert gauge
 *
 * @mcp
 */
export const insertGaugeTool = defineServiceFn({
  input: z.looseObject({
    gaugeId: z.string().optional(),
    gaugeTypeId: z.string(),
    gaugeRole: z.enum(["Master", "Standard"]),
    gaugeCalibrationStatus: z.enum([
      "Pending",
      "In-Calibration",
      "Out-of-Calibration"
    ]),
    supplierId: z.string().optional(),
    modelNumber: z.string().optional(),
    serialNumber: z.string().optional(),
    description: z.string().optional(),
    dateAcquired: z.string().optional(),
    lastCalibrationDate: z.string().optional(),
    nextCalibrationDate: z.string().optional(),
    locationId: z.string().optional(),
    storageUnitId: z.string().optional(),
    calibrationIntervalInMonths: z.number().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertGauge(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update gauge
 *
 * @mcp
 */
export const updateGaugeTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    gaugeId: z.string().optional(),
    gaugeTypeId: z.string().optional(),
    gaugeRole: z.enum(["Master", "Standard"]).optional(),
    gaugeCalibrationStatus: z
      .enum(["Pending", "In-Calibration", "Out-of-Calibration"])
      .optional(),
    supplierId: z.string().nullable().optional(),
    modelNumber: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    dateAcquired: z.string().nullable().optional(),
    lastCalibrationDate: z.string().nullable().optional(),
    nextCalibrationDate: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    storageUnitId: z.string().nullable().optional(),
    calibrationIntervalInMonths: z.number().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateGauge(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a gauge calibration record
 *
 * @remarks
 * Upsert gauge calibration record
 *
 * @mcp
 */
export const upsertGaugeCalibrationRecordCreateTool = defineServiceFn({
  input: z.looseObject({
    gaugeId: z.string().min(1),
    supplierId: z.string().optional(),
    dateCalibrated: z.string().min(1),
    requiresAction: z.boolean().optional(),
    requiresAdjustment: z.boolean().optional(),
    requiresRepair: z.boolean().optional(),
    temperature: z.number().min(-200).max(500).optional(),
    humidity: z.number().min(0).max(1).optional(),
    approvedBy: z.string().optional(),
    measurementStandard: z.string().optional(),
    calibrationAttempts: z.array(
      z.looseObject({ reference: z.number(), actual: z.number() })
    ),
    notes: z.string().optional(),
    inspectionStatus: z.enum(["Pass", "Fail"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertGaugeCalibrationRecord(
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
 * Update a gauge calibration record
 *
 * @remarks
 * Upsert gauge calibration record
 *
 * @mcp
 */
export const upsertGaugeCalibrationRecordUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      gaugeId: z.string().min(1),
      supplierId: z.string().optional(),
      dateCalibrated: z.string().min(1),
      requiresAction: z.boolean().optional(),
      requiresAdjustment: z.boolean().optional(),
      requiresRepair: z.boolean().optional(),
      temperature: z.number().min(-200).max(500).optional(),
      humidity: z.number().min(0).max(1).optional(),
      approvedBy: z.string().optional(),
      measurementStandard: z.string().optional(),
      calibrationAttempts: z.array(
        z.looseObject({ reference: z.number(), actual: z.number() })
      ),
      notes: z.string().optional(),
      inspectionStatus: z.enum(["Pass", "Fail"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertGaugeCalibrationRecord(
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
 * Create a gauge type
 *
 * @remarks
 * Upsert gauge type
 *
 * @mcp
 */
export const upsertGaugeTypeCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertGaugeType(
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
 * Update a gauge type
 *
 * @remarks
 * Upsert gauge type
 *
 * @mcp
 */
export const upsertGaugeTypeUpdateTool = defineServiceFn({
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
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertGaugeType(
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
 * Insert issue
 *
 * @mcp
 */
export const insertIssueTool = defineServiceFn({
  input: z.looseObject({
    nonConformanceId: z.string().optional(),
    name: z.string(),
    priority: z.enum(["Low", "Medium", "High", "Critical"]),
    source: z.enum(["Internal", "External"]),
    locationId: z.string(),
    nonConformanceTypeId: z.string(),
    openDate: z.string().optional(),
    description: z.string().optional(),
    nonConformanceWorkflowId: z.string().optional(),
    dueDate: z.string().optional(),
    closeDate: z.string().optional(),
    quantity: z.number().optional(),
    requiredActionIds: z.array(z.string()).optional(),
    approvalRequirements: z.array(z.literal("MRB")).optional(),
    items: z.array(z.string()).optional(),
    jobOperationId: z.string().optional(),
    customerId: z.string().optional(),
    salesOrderLineId: z.string().optional(),
    operationSupplierProcessId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertIssue(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update issue
 *
 * @mcp
 */
export const updateIssueTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    nonConformanceId: z.string().optional(),
    name: z.string().optional(),
    priority: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
    source: z.enum(["Internal", "External"]).optional(),
    locationId: z.string().optional(),
    nonConformanceTypeId: z.string().optional(),
    nonConformanceWorkflowId: z.string().nullable().optional(),
    openDate: z.string().optional(),
    dueDate: z.string().nullable().optional(),
    closeDate: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    quantity: z.number().optional(),
    requiredActionIds: z.array(z.string()).optional(),
    approvalRequirements: z.array(z.literal("MRB")).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateIssue(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a issue workflow
 *
 * @remarks
 * Upsert issue workflow
 *
 * @mcp
 */
export const upsertIssueWorkflowCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    content: z.string().min(1),
    priority: z.enum(["Low", "Medium", "High", "Critical"]),
    source: z.enum(["Internal", "External"]),
    requiredActionIds: z.string().optional(),
    approvalRequirements: z.array(z.literal("MRB")).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertIssueWorkflow(
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
 * Update a issue workflow
 *
 * @remarks
 * Upsert issue workflow
 *
 * @mcp
 */
export const upsertIssueWorkflowUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      content: z.string().min(1),
      priority: z.enum(["Low", "Medium", "High", "Critical"]),
      source: z.enum(["Internal", "External"]),
      requiredActionIds: z.string().optional(),
      approvalRequirements: z.array(z.literal("MRB")).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertIssueWorkflow(
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
 * Create a issue type
 *
 * @remarks
 * Upsert issue type
 *
 * @mcp
 */
export const upsertIssueTypeCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertIssueType(
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
 * Update a issue type
 *
 * @remarks
 * Upsert issue type
 *
 * @mcp
 */
export const upsertIssueTypeUpdateTool = defineServiceFn({
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
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertIssueType(
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
 * Create a required action
 *
 * @remarks
 * Upsert required action
 *
 * @mcp
 */
export const upsertRequiredActionCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    active: z.boolean().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertRequiredAction(
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
 * Update a required action
 *
 * @remarks
 * Upsert required action
 *
 * @mcp
 */
export const upsertRequiredActionUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      active: z.boolean().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertRequiredAction(
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
 * Create a quality document
 *
 * @remarks
 * Upsert quality document
 *
 * @mcp
 */
export const upsertQualityDocumentCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    version: z.number().min(0),
    content: z.string().optional(),
    copyFromId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQualityDocument(
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
 * Update a quality document
 *
 * @remarks
 * Upsert quality document
 *
 * @mcp
 */
export const upsertQualityDocumentUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      version: z.number().min(0),
      content: z.string().optional(),
      copyFromId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQualityDocument(
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
 * Get inspections
 *
 * @mcp read
 */
export const getInspectionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    source: z.string().nullable().optional()
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getInspections(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get inspection
 *
 * @mcp read
 */
export const getInspectionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getInspection(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get receipt inspections
 *
 * @mcp read
 */
export const getReceiptInspectionsTool = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReceiptInspections(
        ctx.asCaller.supabase,
        input.receiptId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection tracked entities
 *
 * @mcp read
 */
export const getInspectionTrackedEntitiesTool = defineServiceFn({
  input: z.looseObject({ receiptLineId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionTrackedEntities(
        ctx.asCaller.supabase,
        input.receiptLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection sampling plans
 *
 * @mcp read
 */
export const getInspectionSamplingPlansTool = defineServiceFn({
  input: z.looseObject({ inspectionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionSamplingPlans(
        ctx.asCaller.supabase,
        input.inspectionId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection gauges
 *
 * @mcp read
 */
export const getInspectionGaugesTool = defineServiceFn({
  input: z.looseObject({ inspectionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionGauges(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.inspectionId as never
      )
    );
  }
});

/**
 * Get inspection measurements
 *
 * @mcp read
 */
export const getInspectionMeasurementsTool = defineServiceFn({
  input: z.looseObject({ inspectionId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionMeasurements(
        ctx.asCaller.supabase,
        input.inspectionId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item inspection document assignments
 *
 * @mcp read
 */
export const getItemInspectionDocumentAssignmentsTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemInspectionDocumentAssignments(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert item inspection document assignment
 *
 * @mcp destructive
 */
export const upsertItemInspectionDocumentAssignmentTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    usage: z.literal("Receipt"),
    inspectionDocumentId: z.string().optional()
  }),
  permission: { create: "quality", update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemInspectionDocumentAssignment(
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
 * Get inspection documents
 *
 * @mcp read
 */
export const getInspectionDocumentsTool = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getInspectionDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get inspection documents for item
 *
 * @mcp read
 */
export const getInspectionDocumentsForItemTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionDocumentsForItem(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection document
 *
 * @mcp read
 */
export const getInspectionDocumentTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionDocument(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert inspection document
 *
 * @mcp
 */
export const upsertInspectionDocumentTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().optional(),
    partId: z.string().min(1),
    drawingNumber: z.string().optional(),
    pdfUrl: z.string().optional(),
    annotations: z.string().optional(),
    features: z.string().optional(),
    id: z.string().optional(),
    pageCount: z.number().optional(),
    defaultPageWidth: z.number().optional(),
    defaultPageHeight: z.number().optional()
  }),
  permission: { create: "quality", update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertInspectionDocument(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete inspection document
 *
 * @mcp destructive
 */
export const deleteInspectionDocumentTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteInspectionDocument(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inspection features
 *
 * @mcp read
 */
export const getInspectionFeaturesTool = defineServiceFn({
  input: z.looseObject({ inspectionDocumentId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionFeatures(
        ctx.asCaller.supabase,
        input.inspectionDocumentId as never
      )
    );
  }
});

/**
 * Get balloons
 *
 * @mcp read
 */
export const getBalloonsTool = defineServiceFn({
  input: z.looseObject({ inspectionDocumentId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getBalloons(
        ctx.asCaller.supabase,
        input.inspectionDocumentId as never
      )
    );
  }
});

/**
 * Get inspection plan
 *
 * @mcp read
 */
export const getInspectionPlanTool = defineServiceFn({
  input: z.looseObject({ inspectionDocumentId: z.string() }),
  permission: { view: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInspectionPlan(
        ctx.asCaller.supabase,
        input.inspectionDocumentId as never
      )
    );
  }
});

/**
 * Update inspection document sampling
 *
 * @mcp
 */
export const updateInspectionDocumentSamplingTool = defineServiceFn({
  input: z.looseObject({
    samplingPlanType: z.enum(["All", "First", "Percentage", "AQL"]).nullable(),
    samplingSampleSize: z.number().int().gt(0).nullable(),
    samplingPercentage: z.number().max(100).gt(0).nullable(),
    samplingAql: z.number().gt(0).nullable(),
    samplingInspectionLevel: z
      .enum(["I", "II", "III", "S1", "S2", "S3", "S4"])
      .nullable(),
    samplingSeverity: z.enum(["Normal", "Tightened", "Reduced"]).nullable(),
    inspectionDocumentId: z.string()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateInspectionDocumentSampling(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Save inspection document atomic
 *
 * @mcp
 */
export const saveInspectionDocumentAtomicTool = defineServiceFn({
  input: z.looseObject({
    inspectionDocumentId: z.string(),
    pdfUrl: z.string().nullable().optional(),
    pageCount: z.number().optional(),
    defaultPageWidth: z.number().optional(),
    defaultPageHeight: z.number().optional(),
    features: z.unknown(),
    balloons: z.unknown()
  }),
  permission: { update: "quality" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await saveInspectionDocumentAtomic(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});
