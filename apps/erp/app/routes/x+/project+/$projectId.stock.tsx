// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getProjectBorrows } from "~/modules/projects";
import { getProjectStockOnHand } from "~/modules/projects/projects.server";
import ProjectStock from "~/modules/projects/ui/Stock/ProjectStock";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-stock");

/** The project's own stock and its open borrows, owed and lent. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [onHand, borrows] = await Promise.all([
    getProjectStockOnHand(getDatabaseClient(), { companyId, projectId }),
    getProjectBorrows(client, companyId, { projectId, status: ["Open"] })
  ]);

  if (borrows.error) {
    logger.error("Failed to load the project's borrows", {
      companyId,
      projectId,
      error: borrows.error
    });
  }

  return { onHand, borrows: borrows.data ?? [] };
}

export default function ProjectStockRoute() {
  const { onHand, borrows } = useLoaderData<typeof loader>();
  return <ProjectStock onHand={onHand} borrows={borrows} />;
}
