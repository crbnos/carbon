// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { type LoaderFunctionArgs, useLoaderData } from "react-router";
import ProjectStock from "~/modules/projects/ui/Stock/ProjectStock";

const logger = getLogger("erp", "project-stock");

/** The page lists the latest transfers; "All transfers" opens the rest. */
const TRANSFER_LIMIT = 10;

/** The project's own stock, its open borrows owed and lent, and its latest transfers. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api, companyId } = await authorize(request, {
    "projects.projects": "View"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [onHand, borrows, transfers] = await Promise.all([
    api.projects.getProjectStockOnHand({ projectId }),
    api.projects.getProjectBorrows({ projectId, status: ["Open"] }),
    api.projects.getProjectStockTransfers({
      projectId,
      search: null,
      limit: TRANSFER_LIMIT,
      offset: 0
    })
  ]);

  if (onHand.error) {
    logger.error("Failed to load the project's stock", {
      companyId,
      projectId,
      error: onHand.error
    });
  }

  if (borrows.error) {
    logger.error("Failed to load the project's borrows", {
      companyId,
      projectId,
      error: borrows.error
    });
  }

  if (transfers.error) {
    logger.error("Failed to load the project's transfers", {
      companyId,
      projectId,
      error: transfers.error
    });
  }

  return {
    onHand: onHand.data ?? [],
    borrows: borrows.data ?? [],
    transfers: transfers.data?.rows ?? []
  };
}

export default function ProjectStockRoute() {
  const { onHand, borrows, transfers } = useLoaderData<typeof loader>();
  return (
    <ProjectStock onHand={onHand} borrows={borrows} transfers={transfers} />
  );
}
