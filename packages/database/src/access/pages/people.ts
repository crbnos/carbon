// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const PEOPLE_PAGES = [
  {
    id: "people.employees",
    label: "Employees",
    maxLevel: "Full",
    tables: ["employeeJob", "employeeShift"],
    readers: ["userAttribute"],
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
  }
] as const satisfies readonly Page[];
