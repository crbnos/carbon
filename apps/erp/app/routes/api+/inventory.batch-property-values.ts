// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getBatchPropertyValues } from "~/modules/inventory/inventory.service";

/** The values of one tracked-entity list property column, for its filter. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const key = new URL(request.url).searchParams.get("key");
  if (!key) return { data: [], error: null };

  return getBatchPropertyValues(client, companyId, key);
}
