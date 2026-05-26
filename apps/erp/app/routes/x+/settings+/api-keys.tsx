import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { ApiKeysTable, ApiKeysUpgradeOverlay } from "~/modules/settings";
import { getApiKeys } from "~/modules/settings/settings.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`API Keys`,
  to: path.to.apiKeys
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    update: "users"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const apiKeys = await getApiKeys({
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
