// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getSystemStatus } from "@carbon/lib/system-status.server";
import { cachedClientLoader, RefreshRate } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";

// The deployment's status document (latest version, announcement), or null
// when SYSTEM_STATUS_URL is unset. The same for every company.
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});
  return await getSystemStatus();
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.High
});
