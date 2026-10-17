// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  RecordOutlet,
  VStack
} from "@carbon/react";
import { indexBy, indexByMapped, pluckUnique, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { LuInfo } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getTaxCodesList } from "~/modules/accounting";
import type { SupplierReportContactsBySupplierId } from "~/modules/purchasing";
import { getSupplierReportContacts, getSuppliers } from "~/modules/purchasing";
import { SuppliersTable } from "~/modules/purchasing/ui/Supplier";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["supplier"],
  breadcrumb: msg`Suppliers`,
  to: path.to.suppliers
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suppliers, tags, taxCodes] = await Promise.all([
    getSuppliers(client, companyId, {
      search,
      type,
      status,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "supplier"),
    getTaxCodesList(client, companyId)
  ]);

  // Once the company has a tax code, count the suppliers still taxed by the
  // legacy bare percent: a percent above zero and no tax code.
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

  if (suppliers.error) {
    redirect(
      path.to.purchasing,
      await flash(request, error(suppliers.error, "Failed to fetch suppliers"))
    );
  }

  const supplierIds = pluckUnique(suppliers.data, (s) => s.id);

  const [purchasingRes, paymentRes, shippingRes] =
    await getSupplierReportContacts(client, companyId, supplierIds);

  const purchasingBySupplierId = indexByMapped(
    purchasingRes.data,
    (r) => r.id,
    (r) => r.purchasingContact
  );
  const paymentBySupplierId = indexBy(paymentRes.data, (r) => r.supplierId);
  const shippingBySupplierId = indexBy(shippingRes.data, (r) => r.supplierId);

  const supplierReportContacts: SupplierReportContactsBySupplierId =
    Object.fromEntries(
      supplierIds.map((id) => [
        id,
        {
          purchasingContact: purchasingBySupplierId.get(id) ?? null,
          payment: paymentBySupplierId.get(id) ?? null,
          shipping: shippingBySupplierId.get(id) ?? null
        }
      ])
    );

  return {
    count: suppliers.count ?? 0,
    suppliers: suppliers.data ?? [],
    tags: tags.data ?? [],
    supplierReportContacts,
    suppliersWithoutTaxCode
  };
}

export default function PurchasingSuppliersRoute() {
  const {
    count,
    suppliers,
    tags,
    supplierReportContacts,
    suppliersWithoutTaxCode
  } = useLoaderData<typeof loader>();

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
        tags={tags}
        supplierReportContacts={supplierReportContacts}
      />
      <RecordOutlet />
    </VStack>
  );
}
