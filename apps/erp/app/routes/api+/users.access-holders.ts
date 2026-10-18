// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Level } from "@carbon/database/access";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });
  const params = new URL(request.url).searchParams;
  const result = await carbonFor(auth).users.getPageAccessHolders({
    page: params.get("page") ?? "",
    // The service function checks both against the registry and the levels.
    level: (params.get("level") ?? "View") as Level
  });
  return {
    people: result.data?.people ?? [],
    apiKeys: result.data?.apiKeys ?? [],
    error: result.error?.message ?? null
  };
}

export const clientLoader = cachedClientLoader<typeof loader>();
