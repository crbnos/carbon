// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getShippingMethodsList } from "~/modules/inventory";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return await getShippingMethodsList(client, companyId);
}

export const clientLoader = cachedClientLoader<typeof loader>();
