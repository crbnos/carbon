// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { indexBy, indexByMapped, pluckUnique, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { SupplierReportContactsBySupplierId } from "~/modules/purchasing/types";
import { SuppliersTable } from "~/modules/purchasing/ui/Supplier";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["supplier"],
  breadcrumb: msg`Suppliers`,
  to: path.to.suppliers
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "purchasing.suppliers": "View" },
    { bypassRls: true }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suppliers, tags] = await Promise.all([
    api.purchasing.getSuppliers({
      search,
      type,
      status,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "supplier" })
  ]);

  if (suppliers.error) {
    redirect(
      path.to.purchasing,
      await flash(request, error(suppliers.error, "Failed to fetch suppliers"))
    );
  }

  const supplierIds = pluckUnique(suppliers.data?.rows, (s) => s.id);

  const contacts = await api.purchasing.getSupplierReportContacts({
    supplierIds
  });
  const [purchasing, payment, shipping] = contacts.data ?? [[], [], []];

  const purchasingBySupplierId = indexByMapped(
    purchasing,
    (r) => r.id,
    (r) => r.purchasingContact
  );
  const paymentBySupplierId = indexBy(payment, (r) => r.supplierId);
  const shippingBySupplierId = indexBy(shipping, (r) => r.supplierId);

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
    count: suppliers.data?.count ?? 0,
    suppliers: suppliers.data?.rows ?? [],
    tags: tags.data ?? [],
    supplierReportContacts
  };
}

export default function PurchasingSuppliersRoute() {
  const { count, suppliers, tags, supplierReportContacts } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
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
