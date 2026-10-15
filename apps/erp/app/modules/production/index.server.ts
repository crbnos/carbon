// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cancelJob,
  closeJob,
  completeJob,
  configureJob,
  copyMethodToJob,
  copyMethodToMaterial,
  createJobMaterial,
  createJobOperation,
  createJobs,
  createProductionEvent,
  deleteJobMaterial,
  deleteJobOperation,
  deleteJobs,
  pauseJob,
  planDraftJob,
  releaseBatches,
  releaseJobs,
  reopenJob,
  reorderJobOperations,
  reorderScheduleOperations,
  replanAfterItemChange,
  resumeJob,
  setJobDeadline,
  setJobFields,
  setJobItem,
  setJobOperationDueDate,
  setJobOperationStatus,
  setJobQuantity,
  setJobSalesOrderLine,
  syncJobOperationProcedure,
  updateJobDetails,
  updateJobMaterial,
  updateJobOperation,
  updateProductionEvent
} from "./production.server";

/** The production module's operations, by entity. */
export const production = {
  job: {
    release: releaseJobs,
    cancel: cancelJob,
    plan: planDraftJob,
    pause: pauseJob,
    resume: resumeJob,
    reopen: reopenJob,
    close: closeJob,
    complete: completeJob,
    createMany: createJobs,
    update: updateJobDetails,
    configure: configureJob,
    delete: deleteJobs,
    setItem: setJobItem,
    setDeadline: setJobDeadline,
    setQuantity: setJobQuantity,
    setSalesOrderLine: setJobSalesOrderLine,
    setFields: setJobFields
  },
  method: { copyToJob: copyMethodToJob, copyToMaterial: copyMethodToMaterial },
  material: {
    create: createJobMaterial,
    update: updateJobMaterial,
    delete: deleteJobMaterial
  },
  operation: {
    create: createJobOperation,
    update: updateJobOperation,
    delete: deleteJobOperation,
    reorder: reorderJobOperations,
    setStatus: setJobOperationStatus,
    setDueDate: setJobOperationDueDate,
    syncProcedure: syncJobOperationProcedure
  },
  event: { create: createProductionEvent, update: updateProductionEvent },
  batch: { release: releaseBatches },
  schedule: { reorder: reorderScheduleOperations },
  planning: { replanItem: replanAfterItemChange }
};
