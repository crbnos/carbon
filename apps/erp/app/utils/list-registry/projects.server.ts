// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  getProjectCostTotals,
  getProjects,
  PROJECTS_PAGING
} from "~/modules/projects/projects.service";
import { getDatabaseClient } from "~/services/database.server";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

// Budget, committed and actual come from the project cost summary, read for
// the rows of each page.
export const projectsList = searchList({
  key: "projects",
  permission: { view: "projects" },
  paging: PROJECTS_PAGING,
  service: getProjects,
  rows: async (rows, { companyId }) => {
    const totals = await getProjectCostTotals(getDatabaseClient(), {
      companyId,
      projectIds: rows.map((project) => project.id)
    });
    return rows.map((project) => ({
      ...project,
      budget: totals[project.id]?.budget ?? 0,
      committed: totals[project.id]?.committed ?? 0,
      actual: totals[project.id]?.actual ?? 0
    }));
  }
});

// The projects lists. Each entry follows `sales.server.ts`.
export const projectsLists: Record<string, ListDefinition> = {
  [projectsList.key]: projectsList
};
