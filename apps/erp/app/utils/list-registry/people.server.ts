// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ATTRIBUTE_CATEGORIES_PAGING,
  getAttributeCategories,
  getHolidays,
  getPeople,
  getShifts,
  getTimecardEntries,
  HOLIDAYS_PAGING,
  SHIFTS_PAGING,
  TIMECARD_ENTRIES_PAGING
} from "~/modules/people/people.service";
import { EMPLOYEES_PAGING } from "~/modules/users/users.service";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

// The people list searches with `?name=`, not `?search=`.
export const peopleList = searchList({
  key: "people",
  permission: { view: "people", role: "employee" },
  paging: EMPLOYEES_PAGING,
  service: getPeople,
  params: { search: "name" }
});

export const attributeCategoriesList = searchList({
  key: "attribute-categories",
  permission: { view: "people", role: "employee" },
  paging: ATTRIBUTE_CATEGORIES_PAGING,
  service: getAttributeCategories
});

export const holidaysList = searchList({
  key: "holidays",
  permission: { view: "people", role: "employee" },
  paging: HOLIDAYS_PAGING,
  service: getHolidays
});

export const shiftsList = searchList({
  key: "shifts",
  permission: { view: "people", role: "employee" },
  paging: SHIFTS_PAGING,
  service: getShifts
});

export const timecardEntriesList = searchList({
  key: "timecards",
  permission: { view: "people" },
  paging: TIMECARD_ENTRIES_PAGING,
  service: getTimecardEntries
});

// The people lists. Each entry follows `sales.server.ts`.
export const peopleLists: Record<string, ListDefinition> = {
  [peopleList.key]: peopleList,
  [attributeCategoriesList.key]: attributeCategoriesList,
  [holidaysList.key]: holidaysList,
  [shiftsList.key]: shiftsList,
  [timecardEntriesList.key]: timecardEntriesList
};
