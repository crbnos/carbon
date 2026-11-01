// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { NewAction } from "~/components/New";
import { usePermissions } from "~/hooks";
import { AssetClassesTable } from "~/modules/accounting/ui/FixedAssets";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { assetClassesList } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Asset Classes`,
  to: path.to.assetClasses
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, assetClassesList, {
    dataKey: "data",
    firstPage: async ({ client, companyId }) => {
      const companySettings = await getCompanySettings(client, companyId);
      return {
        taxDepreciationEnabled:
          (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false
      };
    }
  });
}

export default function AssetClassesRoute() {
  const { data, count, infinite, taxDepreciationEnabled } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <AssetClassesTable
        data={data}
        count={count}
        infinite={infinite}
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
