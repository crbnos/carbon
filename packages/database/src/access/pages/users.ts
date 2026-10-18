// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

// A grant belongs to a role, a person or an API key: the column it sets picks
// its page (Employee Types, Accounts, or Settings → API Keys).
export const USERS_PAGES = [
  {
    id: "users.accounts",
    label: "Accounts",
    maxLevel: "Full",
    tables: ["user", "employee", "userToCompany", "permission"],
    where: { table: "permission", column: "userId" },
    paths: [
      "/x/users/employees",
      "/x/users/customers",
      "/x/users/suppliers",
      "/x/users/bulk-edit-permissions",
      "/x/users/deactivate",
      "/x/users/resend-invite",
      "/x/users/revoke-invite"
    ]
  },
  {
    id: "users.operators",
    label: "Operators",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/users/operators"]
  },
  {
    id: "users.groups",
    label: "Groups",
    maxLevel: "Full",
    tables: ["group", "membership"],
    paths: ["/x/users/groups"]
  },
  {
    id: "users.employeeTypes",
    label: "Employee Types",
    maxLevel: "Full",
    tables: ["employeeType", "employeeTypePermission", "permission"],
    where: { table: "permission", column: "employeeTypeId" },
    paths: ["/x/users/employee-types"]
  }
] as const satisfies readonly Page[];
