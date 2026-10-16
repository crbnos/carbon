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

/** The resources module's operations, by entity. */
export const resources = {
  ability: { create: createAbility, deactivate: deactivateAbility },
  employeeAbility: {
    add: addEmployeeAbility,
    update: updateEmployeeAbility,
    remove: removeEmployeeAbility
  },
  location: { create: createLocation, update: updateLocation },
  process: { create: createProcess, update: updateProcess },
  workCenter: {
    create: createWorkCenter,
    update: updateWorkCenter,
    reactivate: reactivateWorkCenter,
    deactivate: deactivateWorkCenter
  },
  maintenanceSchedule: {
    create: createMaintenanceSchedule,
    update: updateMaintenanceSchedule
  },
  maintenanceDispatch: {
    create: createMaintenanceDispatch,
    updateField: updateMaintenanceDispatchField,
    setStatus: setMaintenanceDispatchStatus
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
  suggestion: { create: createSuggestion },
  training: { updateField: updateTrainingField },
  trainingAssignment: {
    create: createTrainingAssignment,
    update: updateTrainingAssignment,
    complete: completeTrainingAssignment,
    uncomplete: uncompleteTrainingAssignment
  }
};
