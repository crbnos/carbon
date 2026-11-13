// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const LABEL = "People";

export const PAGES = [
  {
    id: "people.employees",
    label: "Employees",
    maxLevel: "Full",
    tables: ["employeeJob", "employeeShift"],
    // resources.assignments, which moved from People (resources.ts alsoWrittenBy).
    readers: ["trainingAssignment"],
    paths: ["/x/people/employee", "/x/person/"]
  },
  {
    id: "people.timecards",
    label: "Timecards",
    maxLevel: "Full",
    tables: ["timeCardEntry"],
    paths: ["/x/people/timecard"]
  },
  {
    id: "people.attributes",
    label: "Attributes",
    maxLevel: "Full",
    tables: ["userAttributeCategory", "userAttribute", "userAttributeValue"],
    // Moved from Resources, which had no screen for them: Abilities holds its person pages.
    // userAttribute and userAttributeValue check their category, so its entry is the one RLS renders.
    alsoWrittenBy: {
      userAttributeCategory: ["resources.abilities"],
      userAttribute: ["resources.abilities"],
      userAttributeValue: ["resources.abilities"]
    },
    paths: ["/x/people/attributes", "/x/people/attribute/"]
  },
  {
    id: "people.departments",
    label: "Departments",
    maxLevel: "Full",
    tables: ["department"],
    paths: ["/x/people/departments"]
  },
  {
    id: "people.holidays",
    label: "Holidays",
    maxLevel: "Full",
    tables: ["holiday"],
    paths: ["/x/people/holidays"]
  },
  {
    id: "people.shifts",
    label: "Shifts",
    maxLevel: "Full",
    tables: ["shift"],
    paths: ["/x/people/shifts"]
  },
  {
    // Government contracting: the payroll check of the labor distribution report.
    id: "people.payrollTotals",
    label: "Payroll Totals",
    maxLevel: "Full",
    tables: ["payrollPeriodTotal"],
    paths: ["/x/people/payroll-totals"]
  }
] as const satisfies readonly Page[];
