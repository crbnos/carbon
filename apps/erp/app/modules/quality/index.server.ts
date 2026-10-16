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
    }
  },
  issueWorkflow: { updateField: updateIssueWorkflowField },
  inspection: { reject: rejectInspection },
  inspectionDocument: {
    save: saveInspectionDocument,
    setDrawingNumber: setInspectionDocumentDrawingNumber
  },
  qualityDocument: {
    updateField: updateQualityDocumentField,
    decideApproval: decideQualityDocumentApproval,
    seed: seedQualityDocuments
  },
  risk: { create: createRisk, update: updateRisk },
  scar: {
    setTaskStatus: setScarTaskStatus,
    updateTaskNotes: updateScarTaskNotes
  }
};
