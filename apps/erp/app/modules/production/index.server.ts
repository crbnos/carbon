// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  applyPlanningActions,
  assignPerson,
  assignPersonWeek,
  assignProductionPlanningActions,
  cancelAssemblyJob,
  cancelJob,
  clearPersonAbsence,
  closeJob,
  completeJob,
  configureJob,
  convertAssemblyModel,
  copyMethodToJob,
  copyMethodToMaterial,
  copyPeopleDay,
  copyPeopleWeekBoard,
  createAssemblyInstruction,
  createBatch,
  createJob,
  createJobMaterial,
  createJobOperation,
  createJobs,
  createProductionEvent,
  createProductionQuantity,
  deleteJobMaterial,
  deleteJobOperation,
  deleteJobs,
  dismissProductionPlanningActions,
  generateAssemblySteps,
  mapAssemblyComponent,
  markPersonAbsent,
  markPersonAbsentRange,
  matchAssemblyBom,
  mergeBatchOutputs,
  movePerson,
  movePersonWeek,
  moveScheduleJob,
  orderPlannedJobs,
  pauseJob,
  planDraftJob,
  planJobFromPlanning,
  reassignAssemblyComponents,
  reconvertAssemblyModel,
  releaseBatches,
  releaseJobs,
  reopenJob,
  reopenProductionPlanningActions,
  reorderJobOperations,
  reorderScheduleOperations,
  replanAfterItemChange,
  replanAssembly,
  reprioritizeBatch,
  resumeJob,
  setAssemblyStepComponents,
  setJobDeadline,
  setJobFields,
  setJobItem,
  setJobOperationDueDate,
  setJobOperationStatus,
  setJobQuantity,
  setJobSalesOrderLine,
  setPeopleOvertime,
  setPersonDay,
  setPersonHours,
  setProcedureFields,
  syncAssemblyToOperation,
  syncJobOperationProcedure,
  unassignPerson,
  unassignPersonWeek,
  unreleaseBatch,
  updateBatch,
  updateJobDetails,
  updateJobMaterial,
  updateJobOperation,
  updatePlannedJob,
  updateProductionEvent,
  updateProductionQuantity
} from "./production.server";
import {
  activateAssemblyInstructionVersionTool,
  convertSalesOrderLinesToJobsTool,
  copyAssemblyInstructionAsVersionTool,
  createJobDocumentUploadUrlTool,
  deleteAssemblyComponentMappingTool,
  deleteAssemblyInstructionStepMaterialTool,
  deleteAssemblyInstructionStepSlideTool,
  deleteAssemblyInstructionStepTool,
  deleteAssemblyInstructionStepToolTool,
  deleteAssemblyInstructionTool,
  deleteAssemblySubAssemblyTool,
  deleteAssemblyUnitTool,
  deleteFailureModeTool,
  deleteJobOperationParameterTool,
  deleteJobOperationStepSlideTool,
  deleteJobOperationStepTool,
  deleteJobOperationToolTool,
  deleteMaintenanceDispatchEventTool,
  deleteMaintenanceDispatchTool,
  deleteMaintenanceScheduleTool,
  deleteProcedureParameterTool,
  deleteProcedureStepTool,
  deleteProcedureTool,
  deleteProductionEventTool,
  deleteProductionQuantityTool,
  deleteScrapReasonTool,
  duplicateJobOperationStepTool,
  getActiveEmployeeAbilitiesTool,
  getActiveJobOperationByJobIdTool,
  getActiveJobOperationsByLocationTool,
  getActiveProductionEventsTool,
  getAssemblyComponentMappingsTool,
  getAssemblyInstructionStepMaterialsTool,
  getAssemblyInstructionStepSlidesTool,
  getAssemblyInstructionStepsTool,
  getAssemblyInstructionStepToolsTool,
  getAssemblyInstructionsForItemTool,
  getAssemblyInstructionsTool,
  getAssemblyInstructionTool,
  getAssemblyInstructionVersionsTool,
  getAssemblyPlanJsonTool,
  getAssemblyUnitsTool,
  getBatchableOperationsTool,
  getBatchableProcessesTool,
  getBatchOutputLotsTool,
  getCapacityReservationsForResourcesTool,
  getCompletionJobsTool,
  getDemandProjectionsTool,
  getFailureModesListTool,
  getFailureModesTool,
  getFailureModeTool,
  getFlattenedBomMaterialsTool,
  getJobByOperationIdTool,
  getJobDocumentsTool,
  getJobDocumentsWithItemIdTool,
  getJobExpediteForecastTool,
  getJobMakeMethodByIdTool,
  getJobMaterialItemIdsTool,
  getJobMaterialsByMethodIdTool,
  getJobMaterialsWithQuantityOnHandTool,
  getJobMethodTreeTool,
  getJobOperationAttachmentsTool,
  getJobOperationBatchEventsTool,
  getJobOperationBatchesTool,
  getJobOperationBatchMemberStatsTool,
  getJobOperationBatchMembersTool,
  getJobOperationBatchWithMembersTool,
  getJobOperationDependenciesTool,
  getJobOperationStepRecordsTool,
  getJobOperationsByMethodIdTool,
  getJobOperationsListTool,
  getJobOperationsTool,
  getJobOrderStatusMapTool,
  getJobPurchaseOrderLinesTool,
  getJobReceiptSnapshotTool,
  getJobReleaseReadinessTool,
  getJobsByDateRangeTool,
  getJobsBySalesOrderLineTool,
  getJobsListTool,
  getJobsTool,
  getJobTool,
  getLatestAssemblyPlanJobTool,
  getLocationEmployeesTool,
  getMaintenanceDispatchCommentsTool,
  getMaintenanceDispatchEventsTool,
  getMaintenanceDispatchItemsTool,
  getMaintenanceDispatchTool,
  getMaintenanceDowntimeForResourcesTool,
  getMaintenanceScheduleTool,
  getOutsideOperationsByJobIdTool,
  getPeopleAbsencesRangeTool,
  getPeopleAbsencesTool,
  getPeopleAssignmentsRangeTool,
  getPeopleAssignmentsTool,
  getPeopleCapacityOperationsTool,
  getProceduresListTool,
  getProceduresTool,
  getProcedureTool,
  getProcedureVersionsTool,
  getProductionDataByOperationsTool,
  getProductionEventsTool,
  getProductionEventTool,
  getProductionPlanningTool,
  getProductionProjectionsTool,
  getProductionQuantitiesTool,
  getProductionQuantityTool,
  getRootMakeMethodTool,
  getScrapReasonsListTool,
  getScrapReasonsTool,
  getScrapReasonTool,
  getTrackedEntitiesByJobIdTool,
  getTrackedEntityByJobIdTool,
  getUnbatchedBatchableOperationCountTool,
  getUnscheduledJobsTool,
  getWorkCenterRequiredAbilitiesTool,
  getWorkCenterReservationsRangeTool,
  getWorkCenterShiftsTool,
  insertAssemblyInstructionStepTool,
  insertJobTool,
  makeAssemblySubAssemblyTool,
  notifyScheduleInputsChangedTool,
  recalculateJobRequirementsTool,
  runMRPTool,
  setJobMaterialStepLinkTool,
  setJobOperationToolStepLinkTool,
  toViewerStepTool,
  ungroupAssemblySubAssemblyTool,
  updateAssemblyInstructionStatusTool,
  updateAssemblyInstructionStepMaterialOrderTool,
  updateAssemblyInstructionStepOrderTool,
  updateAssemblyInstructionStepStatusTool,
  updateAssemblyStepHiddenComponentsTool,
  updateAssemblyStepMotionTool,
  updateAssemblySubAssemblyTool,
  updateJobBatchNumberTool,
  updateJobMaterialOrderTool,
  updateJobOperationStepOrderTool,
  updateKanbanJobTool,
  updateMethodOperationStepOrderTool,
  updateProcedureStepOrderTool,
  updateQuoteOperationStepOrderTool,
  upsertAssemblyInstructionStepMaterialTool,
  upsertAssemblyInstructionStepSlideCreateTool,
  upsertAssemblyInstructionStepSlideUpdateTool,
  upsertAssemblyInstructionStepTool,
  upsertAssemblyInstructionStepToolTool,
  upsertAssemblyInstructionTool,
  upsertAssemblyUnitTool,
  upsertFailureModeCreateTool,
  upsertFailureModeUpdateTool,
  upsertJobOperationParameterCreateTool,
  upsertJobOperationParameterUpdateTool,
  upsertJobOperationStepCreateTool,
  upsertJobOperationStepSlideCreateTool,
  upsertJobOperationStepSlideUpdateTool,
  upsertJobOperationStepUpdateTool,
  upsertJobOperationToolCreateTool,
  upsertJobOperationToolUpdateTool,
  upsertMaintenanceDispatchCommentCreateTool,
  upsertMaintenanceDispatchCommentUpdateTool,
  upsertMaintenanceDispatchEventCreateTool,
  upsertMaintenanceDispatchEventUpdateTool,
  upsertMaintenanceDispatchItemCreateTool,
  upsertMaintenanceDispatchItemUpdateTool,
  upsertMaintenanceScheduleCreateTool,
  upsertMaintenanceScheduleUpdateTool,
  upsertMakeMethodFromJobMethodTool,
  upsertMakeMethodFromJobTool,
  upsertProcedureCreateTool,
  upsertProcedureParameterCreateTool,
  upsertProcedureParameterUpdateTool,
  upsertProcedureStepCreateTool,
  upsertProcedureStepUpdateTool,
  upsertProcedureUpdateTool,
  upsertScrapReasonCreateTool,
  upsertScrapReasonUpdateTool
} from "./production.tools.server";

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
    create: createJob,
    createMany: createJobs,
    update: updateJobDetails,
    configure: configureJob,
    delete: deleteJobs,
    setItem: setJobItem,
    setDeadline: setJobDeadline,
    setQuantity: setJobQuantity,
    setSalesOrderLine: setJobSalesOrderLine,
    setFields: setJobFields,
    get: getJobTool,
    insert: insertJobTool
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
  quantity: {
    create: createProductionQuantity,
    update: updateProductionQuantity
  },
  procedure: {
    setFields: setProcedureFields,
    delete: deleteProcedureTool,
    get: getProcedureTool,
    create: upsertProcedureCreateTool,
    update: upsertProcedureUpdateTool
  },
  assembly: {
    create: createAssemblyInstruction,
    replan: replanAssembly,
    generateSteps: generateAssemblySteps,
    cancelJob: cancelAssemblyJob,
    convertModel: convertAssemblyModel,
    reconvertModel: reconvertAssemblyModel,
    matchBom: matchAssemblyBom,
    mapComponent: mapAssemblyComponent,
    reassignComponents: reassignAssemblyComponents,
    setStepComponents: setAssemblyStepComponents,
    syncToOperation: syncAssemblyToOperation
  },
  batch: {
    create: createBatch,
    release: releaseBatches,
    unrelease: unreleaseBatch,
    update: updateBatch,
    reprioritize: reprioritizeBatch,
    mergeOutputs: mergeBatchOutputs
  },
  schedule: { reorder: reorderScheduleOperations, moveJob: moveScheduleJob },
  people: {
    assign: assignPerson,
    unassign: unassignPerson,
    move: movePerson,
    setDay: setPersonDay,
    setHours: setPersonHours,
    setOvertime: setPeopleOvertime,
    markAbsent: markPersonAbsent,
    markAbsentRange: markPersonAbsentRange,
    clearAbsence: clearPersonAbsence,
    copyDay: copyPeopleDay,
    assignWeek: assignPersonWeek,
    unassignWeek: unassignPersonWeek,
    moveWeek: movePersonWeek,
    copyWeek: copyPeopleWeekBoard
  },
  planning: {
    replanItem: replanAfterItemChange,
    order: orderPlannedJobs,
    updateJob: updatePlannedJob,
    planJob: planJobFromPlanning,
    apply: applyPlanningActions,
    dismiss: dismissProductionPlanningActions,
    reopen: reopenProductionPlanningActions,
    assign: assignProductionPlanningActions
  },
  salesOrderLinesToJobs: {
    convert: convertSalesOrderLinesToJobsTool
  },
  jobOperationStep: {
    delete: deleteJobOperationStepTool,
    create: upsertJobOperationStepCreateTool,
    update: upsertJobOperationStepUpdateTool,
    duplicate: duplicateJobOperationStepTool
  },
  jobOperationStepSlide: {
    delete: deleteJobOperationStepSlideTool,
    create: upsertJobOperationStepSlideCreateTool,
    update: upsertJobOperationStepSlideUpdateTool
  },
  jobOperationParameter: {
    delete: deleteJobOperationParameterTool,
    create: upsertJobOperationParameterCreateTool,
    update: upsertJobOperationParameterUpdateTool
  },
  jobOperationTool: {
    delete: deleteJobOperationToolTool,
    create: upsertJobOperationToolCreateTool,
    update: upsertJobOperationToolUpdateTool
  },
  procedureStep: {
    delete: deleteProcedureStepTool,
    create: upsertProcedureStepCreateTool,
    update: upsertProcedureStepUpdateTool
  },
  procedureParameter: {
    delete: deleteProcedureParameterTool,
    create: upsertProcedureParameterCreateTool,
    update: upsertProcedureParameterUpdateTool
  },
  productionEvent: {
    delete: deleteProductionEventTool,
    get: getProductionEventTool
  },
  productionQuantity: {
    delete: deleteProductionQuantityTool,
    get: getProductionQuantityTool
  },
  activeJobOperationByJobId: {
    get: getActiveJobOperationByJobIdTool
  },
  activeJobOperationsByLocation: {
    get: getActiveJobOperationsByLocationTool
  },
  jobsByDateRange: {
    get: getJobsByDateRangeTool
  },
  unscheduledJobs: {
    get: getUnscheduledJobsTool
  },
  activeProductionEvents: {
    get: getActiveProductionEventsTool
  },
  scrapReason: {
    delete: deleteScrapReasonTool,
    get: getScrapReasonTool,
    create: upsertScrapReasonCreateTool,
    update: upsertScrapReasonUpdateTool
  },
  failureMode: {
    delete: deleteFailureModeTool,
    get: getFailureModeTool,
    create: upsertFailureModeCreateTool,
    update: upsertFailureModeUpdateTool
  },
  maintenanceDispatch: {
    delete: deleteMaintenanceDispatchTool,
    get: getMaintenanceDispatchTool
  },
  maintenanceDispatchEvent: {
    delete: deleteMaintenanceDispatchEventTool,
    create: upsertMaintenanceDispatchEventCreateTool,
    update: upsertMaintenanceDispatchEventUpdateTool
  },
  maintenanceSchedule: {
    delete: deleteMaintenanceScheduleTool,
    get: getMaintenanceScheduleTool,
    create: upsertMaintenanceScheduleCreateTool,
    update: upsertMaintenanceScheduleUpdateTool
  },
  demandProjections: {
    get: getDemandProjectionsTool
  },
  jobDocuments: {
    get: getJobDocumentsTool
  },
  jobDocumentsWithItemId: {
    get: getJobDocumentsWithItemIdTool
  },
  jobExpediteForecast: {
    get: getJobExpediteForecastTool
  },
  jobByOperationId: {
    get: getJobByOperationIdTool
  },
  jobPurchaseOrderLines: {
    get: getJobPurchaseOrderLinesTool
  },
  completionJobs: {
    get: getCompletionJobsTool
  },
  capacityReservationsForResources: {
    get: getCapacityReservationsForResourcesTool
  },
  maintenanceDowntimeForResources: {
    get: getMaintenanceDowntimeForResourcesTool
  },
  jobs: {
    get: getJobsTool
  },
  jobsBySalesOrderLine: {
    get: getJobsBySalesOrderLineTool
  },
  jobsList: {
    get: getJobsListTool
  },
  jobMakeMethodById: {
    get: getJobMakeMethodByIdTool
  },
  rootMakeMethod: {
    get: getRootMakeMethodTool
  },
  jobMaterialsWithQuantityOnHand: {
    get: getJobMaterialsWithQuantityOnHandTool
  },
  jobMaterialItemIds: {
    get: getJobMaterialItemIdsTool
  },
  jobOrderStatusMap: {
    get: getJobOrderStatusMapTool
  },
  jobMethodTree: {
    get: getJobMethodTreeTool
  },
  jobMaterialsByMethodId: {
    get: getJobMaterialsByMethodIdTool
  },
  jobOperations: {
    get: getJobOperationsTool
  },
  jobOperationDependencies: {
    get: getJobOperationDependenciesTool
  },
  jobOperationAttachments: {
    get: getJobOperationAttachmentsTool
  },
  jobOperationsList: {
    get: getJobOperationsListTool
  },
  jobOperationsByMethodId: {
    get: getJobOperationsByMethodIdTool
  },
  jobOperationStepRecords: {
    get: getJobOperationStepRecordsTool
  },
  outsideOperationsByJobId: {
    get: getOutsideOperationsByJobIdTool
  },
  procedureVersions: {
    get: getProcedureVersionsTool
  },
  procedures: {
    get: getProceduresTool
  },
  proceduresList: {
    get: getProceduresListTool
  },
  productionEvents: {
    get: getProductionEventsTool
  },
  productionPlanning: {
    get: getProductionPlanningTool
  },
  productionProjections: {
    get: getProductionProjectionsTool
  },
  productionQuantities: {
    get: getProductionQuantitiesTool
  },
  productionDataByOperations: {
    get: getProductionDataByOperationsTool
  },
  scrapReasonsList: {
    get: getScrapReasonsListTool
  },
  scrapReasons: {
    get: getScrapReasonsTool
  },
  failureModes: {
    get: getFailureModesTool
  },
  failureModesList: {
    get: getFailureModesListTool
  },
  maintenanceDispatchComments: {
    get: getMaintenanceDispatchCommentsTool
  },
  maintenanceDispatchEvents: {
    get: getMaintenanceDispatchEventsTool
  },
  maintenanceDispatchItems: {
    get: getMaintenanceDispatchItemsTool
  },
  trackedEntityByJobId: {
    get: getTrackedEntityByJobIdTool
  },
  trackedEntitiesByJobId: {
    get: getTrackedEntitiesByJobIdTool
  },
  jobReceiptSnapshot: {
    get: getJobReceiptSnapshotTool
  },
  jobRequirements: {
    recalculate: recalculateJobRequirementsTool
  },
  mRP: {
    run: runMRPTool
  },
  jobBatchNumber: {
    update: updateJobBatchNumberTool
  },
  jobReleaseReadiness: {
    get: getJobReleaseReadinessTool
  },
  jobMaterialOrder: {
    update: updateJobMaterialOrderTool
  },
  jobOperationStepOrder: {
    update: updateJobOperationStepOrderTool
  },
  kanbanJob: {
    update: updateKanbanJobTool
  },
  quoteOperationStepOrder: {
    update: updateQuoteOperationStepOrderTool
  },
  methodOperationStepOrder: {
    update: updateMethodOperationStepOrderTool
  },
  procedureStepOrder: {
    update: updateProcedureStepOrderTool
  },
  jobMaterialStepLink: {
    set: setJobMaterialStepLinkTool
  },
  jobOperationToolStepLink: {
    set: setJobOperationToolStepLinkTool
  },
  makeMethodFromJob: {
    upsert: upsertMakeMethodFromJobTool
  },
  makeMethodFromJobMethod: {
    upsert: upsertMakeMethodFromJobMethodTool
  },
  maintenanceDispatchComment: {
    create: upsertMaintenanceDispatchCommentCreateTool,
    update: upsertMaintenanceDispatchCommentUpdateTool
  },
  maintenanceDispatchItem: {
    create: upsertMaintenanceDispatchItemCreateTool,
    update: upsertMaintenanceDispatchItemUpdateTool
  },
  peopleAssignments: {
    get: getPeopleAssignmentsTool
  },
  peopleAbsences: {
    get: getPeopleAbsencesTool
  },
  peopleAssignmentsRange: {
    get: getPeopleAssignmentsRangeTool
  },
  peopleAbsencesRange: {
    get: getPeopleAbsencesRangeTool
  },
  peopleCapacityOperations: {
    get: getPeopleCapacityOperationsTool
  },
  workCenterShifts: {
    get: getWorkCenterShiftsTool
  },
  workCenterReservationsRange: {
    get: getWorkCenterReservationsRangeTool
  },
  locationEmployees: {
    get: getLocationEmployeesTool
  },
  workCenterRequiredAbilities: {
    get: getWorkCenterRequiredAbilitiesTool
  },
  activeEmployeeAbilities: {
    get: getActiveEmployeeAbilitiesTool
  },
  scheduleInputsChanged: {
    notify: notifyScheduleInputsChangedTool
  },
  unbatchedBatchableOperationCount: {
    get: getUnbatchedBatchableOperationCountTool
  },
  jobOperationBatches: {
    get: getJobOperationBatchesTool
  },
  jobOperationBatchMemberStats: {
    get: getJobOperationBatchMemberStatsTool
  },
  jobOperationBatchMembers: {
    get: getJobOperationBatchMembersTool
  },
  batchOutputLots: {
    get: getBatchOutputLotsTool
  },
  jobOperationBatchWithMembers: {
    get: getJobOperationBatchWithMembersTool
  },
  jobOperationBatchEvents: {
    get: getJobOperationBatchEventsTool
  },
  batchableOperations: {
    get: getBatchableOperationsTool
  },
  batchableProcesses: {
    get: getBatchableProcessesTool
  },
  assemblyInstruction: {
    get: getAssemblyInstructionTool,
    upsert: upsertAssemblyInstructionTool,
    delete: deleteAssemblyInstructionTool
  },
  assemblyInstructions: {
    get: getAssemblyInstructionsTool
  },
  assemblyInstructionsForItem: {
    get: getAssemblyInstructionsForItemTool
  },
  assemblyInstructionSteps: {
    get: getAssemblyInstructionStepsTool
  },
  assemblyInstructionStatus: {
    update: updateAssemblyInstructionStatusTool
  },
  assemblyInstructionVersions: {
    get: getAssemblyInstructionVersionsTool
  },
  assemblyInstructionAsVersion: {
    copy: copyAssemblyInstructionAsVersionTool
  },
  assemblyInstructionVersion: {
    activate: activateAssemblyInstructionVersionTool
  },
  assemblyInstructionStep: {
    upsert: upsertAssemblyInstructionStepTool,
    insert: insertAssemblyInstructionStepTool,
    delete: deleteAssemblyInstructionStepTool
  },
  assemblyStepMotion: {
    update: updateAssemblyStepMotionTool
  },
  assemblyStepHiddenComponents: {
    update: updateAssemblyStepHiddenComponentsTool
  },
  assemblySubAssembly: {
    make: makeAssemblySubAssemblyTool,
    update: updateAssemblySubAssemblyTool,
    ungroup: ungroupAssemblySubAssemblyTool,
    delete: deleteAssemblySubAssemblyTool
  },
  assemblyInstructionStepStatus: {
    update: updateAssemblyInstructionStepStatusTool
  },
  assemblyInstructionStepOrder: {
    update: updateAssemblyInstructionStepOrderTool
  },
  assemblyInstructionStepSlides: {
    get: getAssemblyInstructionStepSlidesTool
  },
  assemblyInstructionStepSlide: {
    create: upsertAssemblyInstructionStepSlideCreateTool,
    update: upsertAssemblyInstructionStepSlideUpdateTool,
    delete: deleteAssemblyInstructionStepSlideTool
  },
  assemblyInstructionStepTools: {
    get: getAssemblyInstructionStepToolsTool
  },
  assemblyInstructionStepTool: {
    upsert: upsertAssemblyInstructionStepToolTool,
    delete: deleteAssemblyInstructionStepToolTool
  },
  assemblyInstructionStepMaterials: {
    get: getAssemblyInstructionStepMaterialsTool
  },
  assemblyInstructionStepMaterial: {
    upsert: upsertAssemblyInstructionStepMaterialTool,
    delete: deleteAssemblyInstructionStepMaterialTool
  },
  assemblyInstructionStepMaterialOrder: {
    update: updateAssemblyInstructionStepMaterialOrderTool
  },
  assemblyUnits: {
    get: getAssemblyUnitsTool
  },
  assemblyUnit: {
    upsert: upsertAssemblyUnitTool,
    delete: deleteAssemblyUnitTool
  },
  latestAssemblyPlanJob: {
    get: getLatestAssemblyPlanJobTool
  },
  assemblyPlanJson: {
    get: getAssemblyPlanJsonTool
  },
  assemblyComponentMappings: {
    get: getAssemblyComponentMappingsTool
  },
  assemblyComponentMapping: {
    delete: deleteAssemblyComponentMappingTool
  },
  flattenedBomMaterials: {
    get: getFlattenedBomMaterialsTool
  },
  viewerStep: {
    to: toViewerStepTool
  },
  jobDocumentUploadUrl: {
    create: createJobDocumentUploadUrlTool
  }
};
