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
import { getFixedAssetClassesList } from "~/modules/accounting/accounting.service";
import { FixedAssetsTable } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { fixedAssetsList } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Fixed Assets`,
  to: path.to.fixedAssets
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, fixedAssetsList, {
    dataKey: "data",
    firstPage: async ({ client, companyId }) => {
      const assetClasses = await getFixedAssetClassesList(client, companyId);
      return { assetClasses: assetClasses.data ?? [] };
    }
  });
}

export default function FixedAssetsRoute() {
  const { data, count, infinite, assetClasses } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <FixedAssetsTable
        data={data}
        count={count}
        infinite={infinite}
        assetClasses={assetClasses}
        primaryAction={
          permissions.can("create", "accounting") && (
            <NewAction label={t`Add Fixed Asset`} to={path.to.newFixedAsset}>
              <Button
                leftIcon={<LuCirclePlus />}
                variant="primary"
                onClick={() => navigate(path.to.newFixedAsset)}
              >
                <Trans>Add Fixed Asset</Trans>
              </Button>
            </NewAction>
          )
        }
      />
      <RecordOutlet />
    </VStack>
  );
}
