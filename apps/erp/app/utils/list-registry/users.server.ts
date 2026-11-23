// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CONSOLE_OPERATORS_PAGING,
  EMPLOYEE_TYPES_PAGING,
  EMPLOYEES_PAGING,
  getConsoleOperators,
  getEmployees,
  getEmployeeTypes
} from "~/modules/users/users.service";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

export const employeeAccountsList = searchList({
  key: "employee-accounts",
  permission: { view: "users", role: "employee" },
  paging: EMPLOYEES_PAGING,
  service: getEmployees
});

export const employeeTypesList = searchList({
  key: "employee-types",
  permission: { view: "users", role: "employee" },
  paging: EMPLOYEE_TYPES_PAGING,
  service: getEmployeeTypes
});

export const consoleOperatorsList = searchList({
  key: "console-operators",
  permission: { view: "users", role: "employee" },
  paging: CONSOLE_OPERATORS_PAGING,
  service: getConsoleOperators
});

// The users lists. Each entry follows `sales.server.ts`.
export const usersLists: Record<string, ListDefinition> = {
  [employeeAccountsList.key]: employeeAccountsList,
  [employeeTypesList.key]: employeeTypesList,
  [consoleOperatorsList.key]: consoleOperatorsList
};
