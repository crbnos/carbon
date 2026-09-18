import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { indexBy, indexByMapped, pluckUnique } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { SupplierReportContactsBySupplierId } from "~/modules/purchasing";
import { getSupplierReportContacts, getSuppliers } from "~/modules/purchasing";
import { SuppliersTable } from "~/modules/purchasing/ui/Supplier";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
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

  const [suppliers, tags] = await Promise.all([
    getSuppliers(client, companyId, {
      search,
      type,
      status,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "supplier")
  ]);

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
      <Outlet />
    </VStack>
  );
}
