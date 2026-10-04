// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getWebhookTables } from "~/modules/settings/settings.service";
import { cachedClientLoader, RefreshRate } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  return await getWebhookTables(client);
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.Never
});
