// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addEmployeeAbility,
  completeTrainingAssignment,
  createAbility,
  createLocation,
  createMaintenanceDispatch,
  createMaintenanceEvent,
  createMaintenanceSchedule,
  createProcess,
  createSuggestion,
  createTrainingAssignment,
  createWorkCenter,
  deactivateAbility,
  deactivateWorkCenter,
  deleteMaintenanceEvent,
  issueMaintenancePart,
  reactivateWorkCenter,
  removeEmployeeAbility,
  setMaintenanceDispatchStatus,
  startMaintenanceEvent,
  stopMaintenanceEvent,
  uncompleteTrainingAssignment,
  unissueMaintenancePart,
  updateEmployeeAbility,
  updateLocation,
  updateMaintenanceDispatchField,
  updateMaintenanceEvent,
  updateMaintenanceSchedule,
  updateProcess,
  updateTrainingAssignment,
  updateTrainingField,
  updateWorkCenter
} from "./resources.server";
import {
  activateProcessTool,
  deleteContractorTool,
  deleteFailureModeTool,
  deleteLocationTool,
  deleteMaintenanceDispatchTool,
  deleteMaintenanceScheduleTool,
  deletePartnerTool,
  deleteProcessTool,
  deleteShiftTool,
  deleteSuggestionTool,
  deleteTrainingAssignmentTool,
  deleteTrainingQuestionTool,
  deleteTrainingTool,
  getAbilitiesListTool,
  getAbilitiesTool,
  getAbilityTool,
  getContractorsTool,
  getContractorTool,
  getEmployeeAbilitiesTool,
  getEmployeeAbilityTool,
  getFailureModesListTool,
  getFailureModesTool,
  getFailureModeTool,
  getLocationsListTool,
  getLocationsTool,
  getLocationTool,
  getMaintenanceDispatchCommentsTool,
  getMaintenanceDispatchEventsTool,
  getMaintenanceDispatchesByLocationTool,
  getMaintenanceDispatchItemsTool,
  getMaintenanceDispatchTool,
  getMaintenanceSchedulesByLocationTool,
  getMaintenanceScheduleTool,
  getOutstandingTrainingsForUserTool,
  getPartnerBySupplierIdTool,
  getPartnersTool,
  getPartnerTool,
  getProcessesListTool,
  getProcessesTool,
  getProcessesWithoutAbilityTool,
  getProcessTool,
  getSuggestionsTool,
  getSuggestionTool,
  getTrainingAssignmentForCompletionTool,
  getTrainingAssignmentStatusForEmployeeTool,
  getTrainingAssignmentStatusTool,
  getTrainingAssignmentSummaryTool,
  getTrainingAssignmentsTool,
  getTrainingAssignmentTool,
  getTrainingsListTool,
  getTrainingsTool,
  getTrainingTool,
  getWorkCentersByLocationTool,
  getWorkCentersListTool,
  getWorkCentersListWithBlockingStatusTool,
  getWorkCentersTool,
  getWorkCenterTool,
  processDeactivateTool,
  updateAbilityTool,
  updateSuggestionEmojiTool,
  updateTrainingQuestionOrderTool,
  upsertContractorCreateTool,
  upsertContractorUpdateTool,
  upsertFailureModeCreateTool,
  upsertFailureModeUpdateTool,
  upsertMaintenanceDispatchCommentCreateTool,
  upsertMaintenanceDispatchCommentUpdateTool,
  upsertMaintenanceDispatchItemCreateTool,
  upsertMaintenanceDispatchItemUpdateTool,
  upsertPartnerCreateTool,
  upsertPartnerUpdateTool,
  upsertTrainingCreateTool,
  upsertTrainingQuestionCreateTool,
  upsertTrainingQuestionUpdateTool,
  upsertTrainingUpdateTool
} from "./resources.tools.server";

/** The resources module's operations, by entity. */
export const resources = {
  ability: {
    create: createAbility,
    deactivate: deactivateAbility,
    get: getAbilityTool,
    update: updateAbilityTool
  },
  employeeAbility: {
    add: addEmployeeAbility,
    update: updateEmployeeAbility,
    remove: removeEmployeeAbility,
    get: getEmployeeAbilityTool
  },
  location: {
    create: createLocation,
    update: updateLocation,
    delete: deleteLocationTool,
    get: getLocationTool
  },
  process: {
    create: createProcess,
    update: updateProcess,
    activate: activateProcessTool,
    delete: deleteProcessTool,
    get: getProcessTool
  },
  workCenter: {
    create: createWorkCenter,
    update: updateWorkCenter,
    reactivate: reactivateWorkCenter,
    deactivate: deactivateWorkCenter,
    get: getWorkCenterTool
  },
  maintenanceSchedule: {
    create: createMaintenanceSchedule,
    update: updateMaintenanceSchedule,
    delete: deleteMaintenanceScheduleTool,
    get: getMaintenanceScheduleTool
  },
  maintenanceDispatch: {
    create: createMaintenanceDispatch,
    updateField: updateMaintenanceDispatchField,
    setStatus: setMaintenanceDispatchStatus,
    delete: deleteMaintenanceDispatchTool,
    get: getMaintenanceDispatchTool
  },
  maintenanceEvent: {
    create: createMaintenanceEvent,
    update: updateMaintenanceEvent,
    delete: deleteMaintenanceEvent,
    start: startMaintenanceEvent,
    stop: stopMaintenanceEvent
  },
  maintenancePart: {
    issue: issueMaintenancePart,
    unissue: unissueMaintenancePart
  },
  suggestion: {
    create: createSuggestion,
    delete: deleteSuggestionTool,
    get: getSuggestionTool
  },
  training: {
    updateField: updateTrainingField,
    delete: deleteTrainingTool,
    get: getTrainingTool,
    create: upsertTrainingCreateTool,
    update: upsertTrainingUpdateTool
  },
  trainingAssignment: {
    create: createTrainingAssignment,
    update: updateTrainingAssignment,
    complete: completeTrainingAssignment,
    uncomplete: uncompleteTrainingAssignment,
    delete: deleteTrainingAssignmentTool,
    get: getTrainingAssignmentTool
  },
  contractor: {
    delete: deleteContractorTool,
    get: getContractorTool,
    create: upsertContractorCreateTool,
    update: upsertContractorUpdateTool
  },
  failureMode: {
    delete: deleteFailureModeTool,
    get: getFailureModeTool,
    create: upsertFailureModeCreateTool,
    update: upsertFailureModeUpdateTool
  },
  partner: {
    delete: deletePartnerTool,
    get: getPartnerTool,
    create: upsertPartnerCreateTool,
    update: upsertPartnerUpdateTool
  },
  deactivate: {
    process: processDeactivateTool
  },
  shift: {
    delete: deleteShiftTool
  },
  trainingQuestion: {
    delete: deleteTrainingQuestionTool,
    create: upsertTrainingQuestionCreateTool,
    update: upsertTrainingQuestionUpdateTool
  },
  abilities: {
    get: getAbilitiesTool
  },
  abilitiesList: {
    get: getAbilitiesListTool
  },
  contractors: {
    get: getContractorsTool
  },
  employeeAbilities: {
    get: getEmployeeAbilitiesTool
  },
  failureModes: {
    get: getFailureModesTool
  },
  failureModesList: {
    get: getFailureModesListTool
  },
  locations: {
    get: getLocationsTool
  },
  locationsList: {
    get: getLocationsListTool
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
  maintenanceDispatchesByLocation: {
    get: getMaintenanceDispatchesByLocationTool
  },
  maintenanceSchedulesByLocation: {
    get: getMaintenanceSchedulesByLocationTool
  },
  outstandingTrainingsForUser: {
    get: getOutstandingTrainingsForUserTool
  },
  trainingAssignmentStatusForEmployee: {
    get: getTrainingAssignmentStatusForEmployeeTool
  },
  partnerBySupplierId: {
    get: getPartnerBySupplierIdTool
  },
  partners: {
    get: getPartnersTool
  },
  processes: {
    get: getProcessesTool
  },
  processesList: {
    get: getProcessesListTool
  },
  suggestions: {
    get: getSuggestionsTool
  },
  trainingAssignmentForCompletion: {
    get: getTrainingAssignmentForCompletionTool
  },
  trainingAssignments: {
    get: getTrainingAssignmentsTool
  },
  trainingAssignmentStatus: {
    get: getTrainingAssignmentStatusTool
  },
  trainingAssignmentSummary: {
    get: getTrainingAssignmentSummaryTool
  },
  trainings: {
    get: getTrainingsTool
  },
  trainingsList: {
    get: getTrainingsListTool
  },
  workCenters: {
    get: getWorkCentersTool
  },
  workCentersByLocation: {
    get: getWorkCentersByLocationTool
  },
  workCentersList: {
    get: getWorkCentersListTool
  },
  workCentersListWithBlockingStatus: {
    get: getWorkCentersListWithBlockingStatusTool
  },
  processesWithoutAbility: {
    get: getProcessesWithoutAbilityTool
  },
  suggestionEmoji: {
    update: updateSuggestionEmojiTool
  },
  trainingQuestionOrder: {
    update: updateTrainingQuestionOrderTool
  },
  maintenanceDispatchComment: {
    create: upsertMaintenanceDispatchCommentCreateTool,
    update: upsertMaintenanceDispatchCommentUpdateTool
  },
  maintenanceDispatchItem: {
    create: upsertMaintenanceDispatchItemCreateTool,
    update: upsertMaintenanceDispatchItemUpdateTool
  }
};
