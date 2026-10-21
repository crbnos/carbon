// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getLaborCategoriesList } from "~/modules/projects/projects.service";

const logger = getLogger("erp", "api-labor-categories");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const categories = await getLaborCategoriesList(client, companyId);
  if (categories.error) {
    logger.error("Failed to load labor categories", {
      companyId,
      error: categories.error
    });
    return { data: [] };
  }

  return { data: categories.data ?? [] };
}

export const clientLoader = cachedClientLoader<typeof loader>();
