// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  completeIssue,
  createIssue,
  createIssueAssociation,
  createRisk,
  decideQualityDocumentApproval,
  draftIssueSupplierReturn,
  rejectInspection,
  reorderIssueActionTasks,
  saveInspectionDocument,
  seedQualityDocuments,
  setInspectionDocumentDrawingNumber,
  setIssueActionDueDate,
  setIssueStatus,
  setIssueTaskStatus,
  setIssueTaskSupplier,
  setScarTaskStatus,
  updateIssueField,
  updateIssueItemField,
  updateIssueWorkflowField,
  updateQualityDocumentField,
  updateRisk,
  updateScarTaskNotes
} from "./quality.server";
import {
  activateGaugeTool,
  deactivateGaugeTool,
  deleteGaugeCalibrationRecordTool,
  deleteGaugeTool,
  deleteGaugeTypeTool,
  deleteInspectionDocumentTool,
  deleteIssueAssociationTool,
  deleteIssueTool,
  deleteIssueTypeTool,
  deleteIssueWorkflowTool,
  deleteQualityDocumentTool,
  deleteRequiredActionTool,
  deleteRiskTool,
  getBalloonsTool,
  getGaugeCalibrationRecordsByGaugeIdTool,
  getGaugeCalibrationRecordsTool,
  getGaugeCalibrationRecordTool,
  getGaugesListTool,
  getGaugesTool,
  getGaugeTool,
  getGaugeTypesListTool,
  getGaugeTypesTool,
  getGaugeTypeTool,
  getInspectionDocumentsForItemTool,
  getInspectionDocumentsTool,
  getInspectionDocumentTool,
  getInspectionFeaturesTool,
  getInspectionGaugesTool,
  getInspectionMeasurementsTool,
  getInspectionPlanTool,
  getInspectionSamplingPlansTool,
  getInspectionsTool,
  getInspectionTool,
  getInspectionTrackedEntitiesTool,
  getIssueActionTasksTool,
  getIssueApprovalTasksTool,
  getIssueAssociationsTool,
  getIssueFromExternalLinkTool,
  getIssueItemsTool,
  getIssueReviewersTool,
  getIssueSuppliersTool,
  getIssuesTool,
  getIssueTool,
  getIssueTypeByNameTool,
  getIssueTypesListTool,
  getIssueTypesTool,
  getIssueTypeTool,
  getIssueWorkflowsListTool,
  getIssueWorkflowsTool,
  getIssueWorkflowTool,
  getItemInspectionDocumentAssignmentsTool,
  getQualityActionsTool,
  getQualityDocumentsTool,
  getQualityDocumentTool,
  getQualityDocumentVersionsTool,
  getQualityFilesTool,
  getReceiptInspectionsTool,
  getRequiredActionsListTool,
  getRequiredActionsTool,
  getRequiredActionTool,
  getRisksTool,
  getRiskTool,
  insertGaugeTool,
  insertIssueReviewerTool,
  insertIssueTool,
  saveInspectionDocumentAtomicTool,
  updateGaugeTool,
  updateInspectionDocumentSamplingTool,
  updateIssueActionProcessesTool,
  updateIssueTool,
  upsertGaugeCalibrationRecordCreateTool,
  upsertGaugeCalibrationRecordUpdateTool,
  upsertGaugeTypeCreateTool,
  upsertGaugeTypeUpdateTool,
  upsertInspectionDocumentTool,
  upsertIssueTypeCreateTool,
  upsertIssueTypeUpdateTool,
  upsertIssueWorkflowCreateTool,
  upsertIssueWorkflowUpdateTool,
  upsertItemInspectionDocumentAssignmentTool,
  upsertQualityDocumentCreateTool,
  upsertQualityDocumentUpdateTool,
  upsertRequiredActionCreateTool,
  upsertRequiredActionUpdateTool
} from "./quality.tools.server";

/** The quality module's operations, by entity. */
export const quality = {
  issue: {
    create: createIssue,
    updateField: updateIssueField,
    setStatus: setIssueStatus,
    close: completeIssue,
    draftSupplierReturn: draftIssueSupplierReturn,
    association: { create: createIssueAssociation },
    item: { updateField: updateIssueItemField },
    task: { setStatus: setIssueTaskStatus, setSupplier: setIssueTaskSupplier },
    action: {
      setDueDate: setIssueActionDueDate,
      reorder: reorderIssueActionTasks
    },
    delete: deleteIssueTool,
    get: getIssueTool,
    insert: insertIssueTool,
    update: updateIssueTool
  },
  issueWorkflow: {
    updateField: updateIssueWorkflowField,
    delete: deleteIssueWorkflowTool,
    get: getIssueWorkflowTool,
    create: upsertIssueWorkflowCreateTool,
    update: upsertIssueWorkflowUpdateTool
  },
  inspection: {
    reject: rejectInspection,
    get: getInspectionTool
  },
  inspectionDocument: {
    save: saveInspectionDocument,
    setDrawingNumber: setInspectionDocumentDrawingNumber,
    get: getInspectionDocumentTool,
    upsert: upsertInspectionDocumentTool,
    delete: deleteInspectionDocumentTool
  },
  qualityDocument: {
    updateField: updateQualityDocumentField,
    decideApproval: decideQualityDocumentApproval,
    seed: seedQualityDocuments,
    delete: deleteQualityDocumentTool,
    get: getQualityDocumentTool,
    create: upsertQualityDocumentCreateTool,
    update: upsertQualityDocumentUpdateTool
  },
  risk: {
    create: createRisk,
    update: updateRisk,
    delete: deleteRiskTool,
    get: getRiskTool
  },
  scar: {
    setTaskStatus: setScarTaskStatus,
    updateTaskNotes: updateScarTaskNotes
  },
  gauge: {
    activate: activateGaugeTool,
    deactivate: deactivateGaugeTool,
    delete: deleteGaugeTool,
    get: getGaugeTool,
    insert: insertGaugeTool,
    update: updateGaugeTool
  },
  gaugeCalibrationRecord: {
    delete: deleteGaugeCalibrationRecordTool,
    get: getGaugeCalibrationRecordTool,
    create: upsertGaugeCalibrationRecordCreateTool,
    update: upsertGaugeCalibrationRecordUpdateTool
  },
  gaugeType: {
    delete: deleteGaugeTypeTool,
    get: getGaugeTypeTool,
    create: upsertGaugeTypeCreateTool,
    update: upsertGaugeTypeUpdateTool
  },
  issueAssociation: {
    delete: deleteIssueAssociationTool
  },
  issueType: {
    delete: deleteIssueTypeTool,
    get: getIssueTypeTool,
    create: upsertIssueTypeCreateTool,
    update: upsertIssueTypeUpdateTool
  },
  requiredAction: {
    delete: deleteRequiredActionTool,
    get: getRequiredActionTool,
    create: upsertRequiredActionCreateTool,
    update: upsertRequiredActionUpdateTool
  },
  issueFromExternalLink: {
    get: getIssueFromExternalLinkTool
  },
  gauges: {
    get: getGaugesTool
  },
  gaugesList: {
    get: getGaugesListTool
  },
  gaugeCalibrationRecords: {
    get: getGaugeCalibrationRecordsTool
  },
  gaugeCalibrationRecordsByGaugeId: {
    get: getGaugeCalibrationRecordsByGaugeIdTool
  },
  gaugeTypesList: {
    get: getGaugeTypesListTool
  },
  gaugeTypes: {
    get: getGaugeTypesTool
  },
  issues: {
    get: getIssuesTool
  },
  issueActionTasks: {
    get: getIssueActionTasksTool
  },
  issueApprovalTasks: {
    get: getIssueApprovalTasksTool
  },
  issueItems: {
    get: getIssueItemsTool
  },
  issueAssociations: {
    get: getIssueAssociationsTool
  },
  issueReviewers: {
    get: getIssueReviewersTool
  },
  issueSuppliers: {
    get: getIssueSuppliersTool
  },
  issueTypeByName: {
    get: getIssueTypeByNameTool
  },
  issueTypes: {
    get: getIssueTypesTool
  },
  issueWorkflows: {
    get: getIssueWorkflowsTool
  },
  issueWorkflowsList: {
    get: getIssueWorkflowsListTool
  },
  issueTypesList: {
    get: getIssueTypesListTool
  },
  qualityActions: {
    get: getQualityActionsTool
  },
  qualityDocumentVersions: {
    get: getQualityDocumentVersionsTool
  },
  qualityDocuments: {
    get: getQualityDocumentsTool
  },
  qualityFiles: {
    get: getQualityFilesTool
  },
  requiredActionsList: {
    get: getRequiredActionsListTool
  },
  requiredActions: {
    get: getRequiredActionsTool
  },
  risks: {
    get: getRisksTool
  },
  issueReviewer: {
    insert: insertIssueReviewerTool
  },
  issueActionProcesses: {
    update: updateIssueActionProcessesTool
  },
  inspections: {
    get: getInspectionsTool
  },
  receiptInspections: {
    get: getReceiptInspectionsTool
  },
  inspectionTrackedEntities: {
    get: getInspectionTrackedEntitiesTool
  },
  inspectionSamplingPlans: {
    get: getInspectionSamplingPlansTool
  },
  inspectionGauges: {
    get: getInspectionGaugesTool
  },
  inspectionMeasurements: {
    get: getInspectionMeasurementsTool
  },
  itemInspectionDocumentAssignments: {
    get: getItemInspectionDocumentAssignmentsTool
  },
  itemInspectionDocumentAssignment: {
    upsert: upsertItemInspectionDocumentAssignmentTool
  },
  inspectionDocuments: {
    get: getInspectionDocumentsTool
  },
  inspectionDocumentsForItem: {
    get: getInspectionDocumentsForItemTool
  },
  inspectionFeatures: {
    get: getInspectionFeaturesTool
  },
  balloons: {
    get: getBalloonsTool
  },
  inspectionPlan: {
    get: getInspectionPlanTool
  },
  inspectionDocumentSampling: {
    update: updateInspectionDocumentSamplingTool
  },
  inspectionDocumentAtomic: {
    save: saveInspectionDocumentAtomicTool
  }
};
