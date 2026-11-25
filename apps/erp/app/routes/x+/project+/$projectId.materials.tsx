// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import ProjectMaterials from "~/modules/projects/ui/Materials/ProjectMaterials";

const logger = getLogger("erp", "project-materials");

/**
 * The project's materials: one row per plan line, plus the issues, PO lines
 * and jobs of the project that no plan line links.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api, companyId } = await authorize(request, {
    "projects.projects": "View"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const materials = await api.projects.getProjectMaterials({ projectId });
  if (materials.error) {
    logger.error("Failed to load the project's materials", {
      companyId,
      projectId,
      error: materials.error
    });
  }

  return {
    rows: materials.data?.rows ?? [],
    isTruncated: materials.data?.isTruncated ?? false,
    loadFailed: Boolean(materials.error)
  };
}

export default function ProjectMaterialsRoute() {
  const { rows, isTruncated, loadFailed } = useLoaderData<typeof loader>();
  return (
    <>
      <ProjectMaterials
        rows={rows}
        isTruncated={isTruncated}
        loadFailed={loadFailed}
      />
      <RecordOutlet />
    </>
  );
}
