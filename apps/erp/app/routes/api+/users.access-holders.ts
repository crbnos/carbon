// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { anyOf, type Level } from "@carbon/database/access";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  // The role form's "Who has access" panel calls it too.
  const { api } = await authorize(
    request,
    anyOf(["users.accounts", "users.employeeTypes"], "View")
  );
  const params = new URL(request.url).searchParams;
  const result = await api.users.getPageAccessHolders({
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
