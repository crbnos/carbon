// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getInspectableTrackedEntities } from "~/modules/quality/quality.service";

const logger = getLogger("erp", "inspection-tracked-entities");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const { itemId } = params;
  if (!itemId) {
    return data({ error: "Item ID is required" }, { status: 400 });
  }

  const entities = await getInspectableTrackedEntities(
    client,
    itemId,
    companyId
  );
  if (entities.error) {
    logger.error("Failed to load the inspectable tracked entities", {
      companyId,
      itemId,
      error: entities.error
    });
    return data(
      { data: [], error: "Failed to load the tracked entities of this item" },
      { status: 500 }
    );
  }
  return { data: entities.data, error: null };
}

export const clientLoader = cachedClientLoader<typeof loader>();
