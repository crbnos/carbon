// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  ApiKeysTable,
  ApiKeysUpgradeOverlay,
  getApiKeys
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`API Keys`,
  to: path.to.apiKeys
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const apiKeys = await getApiKeys(client, companyId, {
    limit,
    offset,
    sorts,
    search,
    filters
  });
  if (apiKeys.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(apiKeys.error, "Failed to load api keys"))
    );
  }

  return {
    apiKeys: apiKeys.data?.map(({ keyHash, ...rest }: any) => rest) ?? [],
    count: apiKeys.count ?? 0,
    companyId
  };
}

export default function ApiKeysRoute() {
  const { apiKeys, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "API_KEYS" });

  if (isGated) {
    return <ApiKeysUpgradeOverlay />;
  }
  return (
    <>
      <ApiKeysTable count={count} data={apiKeys} />
      <Outlet />
    </>
  );
}
