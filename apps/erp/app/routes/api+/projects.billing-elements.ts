// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getProjectBillingElements } from "~/modules/projects/projects.service";

const logger = getLogger("erp", "api-project-billing-elements");

/** The billing elements of one Contract-treatment project, for a contract
 *  line's billing element. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return { data: [] };

  const elements = await getProjectBillingElements(
    client,
    projectId,
    companyId
  );
  if (elements.error) {
    logger.error("Failed to load billing elements", {
      companyId,
      projectId,
      error: elements.error
    });
    return { data: [] };
  }

  return {
    data: elements.data.map(({ id, readableId, name }) => ({
      id,
      readableId,
      name
    }))
  };
}

export const clientLoader = cachedClientLoader<typeof loader>();
