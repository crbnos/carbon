// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { searchRequestCatalog } from "~/services/material-request.service";

const logger = getLogger("mes", "material-request-catalog");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await authorize(request, {});

  const search = new URL(request.url).searchParams.get("search") ?? "";
  const items = await searchRequestCatalog(client, { companyId, search });
  if (items.error) {
    logger.error("Failed to search the request catalog", {
      companyId,
      error: items.error
    });
    return data({ items: [] }, 500);
  }
  return { items: items.data };
}
