// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addPersonTimeCardEntry,
  clockInPerson,
  clockInSelf,
  clockOutPerson,
  clockOutSelf,
  createShift,
  deletePersonTimeCardEntry,
  updatePersonJob,
  updatePersonTimeCardEntry,
  updateShift
} from "./people.server";
import {
  createTimeCardEntryTool,
  deleteAttributeCategoryTool,
  deleteAttributeTool,
  deleteDepartmentTool,
  deleteHolidayTool,
  deleteShiftTool,
  deleteTimeCardEntryTool,
  getAttributeCategoriesTool,
  getAttributeCategoryTool,
  getAttributeDataTypesTool,
  getAttributeTool,
  getDepartmentsListTool,
  getDepartmentsTreeTool,
  getDepartmentTool,
  getEmployeeDepartmentsTool,
  getEmployeeJobTool,
  getEmployeeShiftsTool,
  getEmployeeSummaryTool,
  getHolidaysTool,
  getHolidayTool,
  getHolidayYearsTool,
  getOpenClockEntryTool,
  getPeopleTool,
  getShiftsListTool,
  getShiftsTool,
  getShiftsWithTimesTool,
  getShiftTool,
  getTimeCardEntriesTool,
  getTimeCardEntryTool,
  getTimecardEntriesTool,
  insertAttributeCategoryTool,
  insertAttributeTool,
  insertEmployeeJobTool,
  updateAttributeCategoryTool,
  updateAttributeSortOrderTool,
  updateAttributeTool,
  updateTimeCardEntryTool,
  upsertDepartmentCreateTool,
  upsertDepartmentUpdateTool,
  upsertHolidayCreateTool,
  upsertHolidayUpdateTool
} from "./people.tools.server";

/** The people module's operations, by entity. */
export const people = {
  shift: {
    create: createShift,
    update: updateShift,
    delete: deleteShiftTool,
    get: getShiftTool
  },
  job: { update: updatePersonJob },
  timecard: {
    clockIn: clockInPerson,
    clockOut: clockOutPerson,
    addEntry: addPersonTimeCardEntry,
    updateEntry: updatePersonTimeCardEntry,
    deleteEntry: deletePersonTimeCardEntry
  },
  ownTimecard: { clockIn: clockInSelf, clockOut: clockOutSelf },
  attribute: {
    delete: deleteAttributeTool,
    get: getAttributeTool,
    insert: insertAttributeTool,
    update: updateAttributeTool
  },
  attributeCategory: {
    delete: deleteAttributeCategoryTool,
    get: getAttributeCategoryTool,
    insert: insertAttributeCategoryTool,
    update: updateAttributeCategoryTool
  },
  department: {
    delete: deleteDepartmentTool,
    get: getDepartmentTool,
    create: upsertDepartmentCreateTool,
    update: upsertDepartmentUpdateTool
  },
  holiday: {
    delete: deleteHolidayTool,
    get: getHolidayTool,
    create: upsertHolidayCreateTool,
    update: upsertHolidayUpdateTool
  },
  attributeCategories: {
    get: getAttributeCategoriesTool
  },
  attributeDataTypes: {
    get: getAttributeDataTypesTool
  },
  departmentsList: {
    get: getDepartmentsListTool
  },
  departmentsTree: {
    get: getDepartmentsTreeTool
  },
  employeeJob: {
    get: getEmployeeJobTool,
    insert: insertEmployeeJobTool
  },
  employeeSummary: {
    get: getEmployeeSummaryTool
  },
  holidays: {
    get: getHolidaysTool
  },
  holidayYears: {
    get: getHolidayYearsTool
  },
  people: {
    get: getPeopleTool
  },
  shifts: {
    get: getShiftsTool
  },
  shiftsList: {
    get: getShiftsListTool
  },
  employeeShifts: {
    get: getEmployeeShiftsTool
  },
  employeeDepartments: {
    get: getEmployeeDepartmentsTool
  },
  shiftsWithTimes: {
    get: getShiftsWithTimesTool
  },
  attributeSortOrder: {
    update: updateAttributeSortOrderTool
  },
  timeCardEntry: {
    create: createTimeCardEntryTool,
    delete: deleteTimeCardEntryTool,
    get: getTimeCardEntryTool,
    update: updateTimeCardEntryTool
  },
  openClockEntry: {
    get: getOpenClockEntryTool
  },
  timeCardEntries: {
    get: getTimeCardEntriesTool
  },
  timecardEntries: {
    get: getTimecardEntriesTool
  }
};
