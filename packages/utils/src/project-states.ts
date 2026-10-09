// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

/**
 * The six states every new project starts with. The backfill migration
 * (`*_projects-backfill.sql`) seeds the same rows for existing projects.
 */
export const defaultProjectStates: {
  name: string;
  group: Database["public"]["Enums"]["projectStateGroup"];
  color: string;
  sortOrder: number;
  isDefault: boolean;
}[] = [
  {
    name: "Backlog",
    group: "Backlog",
    color: "#60646C",
    sortOrder: 1,
    isDefault: true
  },
  {
    name: "Todo",
    group: "Unstarted",
    color: "#60646C",
    sortOrder: 2,
    isDefault: true
  },
  {
    name: "In Progress",
    group: "Started",
    color: "#F59E0B",
    sortOrder: 3,
    isDefault: true
  },
  {
    name: "In Review",
    group: "Started",
    color: "#3B82F6",
    sortOrder: 4,
    isDefault: false
  },
  {
    name: "Done",
    group: "Completed",
    color: "#46A758",
    sortOrder: 5,
    isDefault: true
  },
  {
    name: "Cancelled",
    group: "Cancelled",
    color: "#9AA4BC",
    sortOrder: 6,
    isDefault: true
  }
];
