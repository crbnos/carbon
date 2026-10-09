// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { NewAction } from "~/components/New";
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

  return (
    <VStack spacing={0} className="h-full">
      <AssetClassesTable
        data={data}
        count={count}
        taxDepreciationEnabled={taxDepreciationEnabled}
        primaryAction={
          permissions.can("create", "accounting") && (
            <NewAction label={t`Add Asset Class`} to={path.to.newAssetClass}>
              <Button
                leftIcon={<LuCirclePlus />}
                variant="primary"
                onClick={() => navigate(path.to.newAssetClass)}
              >
                <Trans>Add Asset Class</Trans>
              </Button>
            </NewAction>
          )
        }
      />
      <RecordOutlet />
    </VStack>
  );
}
