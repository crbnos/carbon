// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, useCompact, VStack } from "@carbon/react";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { usePermissions } from "~/hooks";
import { getFixedAssetClasses } from "~/modules/accounting";
import { AssetClassesTable } from "~/modules/accounting/ui/FixedAssets";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Asset Classes`,
  to: path.to.assetClasses
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [classes, companySettings] = await Promise.all([
    getFixedAssetClasses(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getCompanySettings(client, companyId)
  ]);

  return {
    data: classes.data ?? [],
    count: classes.count ?? 0,
    taxDepreciationEnabled:
      (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false
  };
}

export default function AssetClassesRoute() {
  const { data, count, taxDepreciationEnabled } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const isCompact = useCompact();

  return (
    <VStack spacing={0} className="h-full">
      <AssetClassesTable
        data={data}
        count={count}
        taxDepreciationEnabled={taxDepreciationEnabled}
        primaryAction={
          permissions.can("create", "accounting") &&
          // Phones: Add becomes the app bar "+" like the other lists.
          (isCompact ? (
            <New label={t`Asset Class`} to={path.to.newAssetClass} />
          ) : (
            <Button
              leftIcon={<LuCirclePlus />}
              variant="primary"
              onClick={() => navigate(path.to.newAssetClass)}
            >
              <Trans>Add Asset Class</Trans>
            </Button>
          ))
        }
      />
      <Outlet />
    </VStack>
  );
}
