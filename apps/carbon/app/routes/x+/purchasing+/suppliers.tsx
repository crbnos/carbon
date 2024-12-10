import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getSupplierStatuses, getSuppliers } from "~/modules/purchasing";
import { SuppliersTable } from "~/modules/purchasing/ui/Supplier";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Suppliers",
  to: path.to.suppliers,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    bypassRls: true,
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suppliers, supplierStatuses] = await Promise.all([
    getSuppliers(client, companyId, {
      search,
      type,
      status,
      limit,
      offset,
      sorts,
      filters,
    }),
    getSupplierStatuses(client, companyId),
  ]);

  if (suppliers.error) {
    redirect(
      path.to.purchasing,
      await flash(request, error(suppliers.error, "Failed to fetch suppliers"))
    );
  }

  return json({
    count: suppliers.count ?? 0,
    suppliers: suppliers.data ?? [],
    supplierStatuses: supplierStatuses.data ?? [],
  });
}

export default function PurchasingSuppliersRoute() {
  const { count, suppliers, supplierStatuses } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SuppliersTable
        data={suppliers}
        count={count}
        supplierStatuses={supplierStatuses}
      />
      <Outlet />
    </VStack>
  );
}
