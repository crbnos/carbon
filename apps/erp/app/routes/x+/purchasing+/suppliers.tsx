// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  RecordOutlet,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { LuInfo } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getTaxCodesList } from "~/modules/accounting/accounting.service";
import { SuppliersTable } from "~/modules/purchasing/ui/Supplier";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { suppliersList } from "~/utils/list-registry/purchasing.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["supplier"],
  breadcrumb: msg`Suppliers`,
  to: path.to.suppliers
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, suppliersList, {
    dataKey: "suppliers",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => {
      const [tags, taxCodes] = await Promise.all([
        getTagsList(client, companyId, "supplier"),
        getTaxCodesList(client, companyId)
      ]);

      // Once the company has a tax code, count the suppliers still taxed by
      // the legacy bare percent: a percent above zero and no tax code.
      const suppliersWithoutTaxCode = taxCodes.data?.length
        ? ((
            await client
              .from("supplier")
              .select("id, supplierTax!inner(taxCodeId)", {
                count: "exact",
                head: true
              })
              .eq("companyId", companyId)
              .gt("taxPercent", 0)
              .is("supplierTax.taxCodeId", null)
          ).count ?? 0)
        : 0;

      return { tags: tags.data ?? [], suppliersWithoutTaxCode };
    },
    onError: {
      redirectTo: path.to.purchasing,
      message: "Failed to fetch suppliers"
    }
  });
}

export default function PurchasingSuppliersRoute() {
  const { count, suppliers, infinite, tags, suppliersWithoutTaxCode } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      {suppliersWithoutTaxCode > 0 && (
        <div className="w-full p-4 pb-0">
          <Alert variant="info">
            <LuInfo className="h-4 w-4" />
            <AlertTitle>
              <Trans>Move to tax codes</Trans>
            </AlertTitle>
            <AlertDescription>
              <Plural
                value={suppliersWithoutTaxCode}
                one="# supplier has a tax percent and no tax code. Select it and choose Assign Tax Code."
                other="# suppliers have a tax percent and no tax code. Select them and choose Assign Tax Code."
              />
            </AlertDescription>
          </Alert>
        </div>
      )}
      <SuppliersTable
        data={suppliers}
        count={count}
        infinite={infinite}
        tags={tags}
      />
      <RecordOutlet />
    </VStack>
  );
}
