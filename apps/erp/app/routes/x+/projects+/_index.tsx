// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { type LoaderFunctionArgs, useLoaderData } from "react-router";
import {
  getProjectCostTotals,
  getProjects
} from "~/modules/projects/projects.service";
import { ProjectsTable } from "~/modules/projects/ui/Projects";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "projects");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const projects = await getProjects(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (projects.error) {
    logger.error("Failed to fetch projects", {
      companyId,
      error: projects.error
    });
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(projects.error, "Failed to fetch projects"))
    );
  }

  const rows = projects.data ?? [];
  const totals = await getProjectCostTotals(getDatabaseClient(), {
    companyId,
    projectIds: rows.map((project) => project.id)
  });

  return {
    count: projects.count ?? 0,
    projects: rows.map((project) => ({
      ...project,
      budget: totals[project.id]?.budget ?? 0,
      committed: totals[project.id]?.committed ?? 0,
      actual: totals[project.id]?.actual ?? 0
    }))
  };
}

export default function ProjectsListRoute() {
  const { count, projects } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProjectsTable data={projects} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
