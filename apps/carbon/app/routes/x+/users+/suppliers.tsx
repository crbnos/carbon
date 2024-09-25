import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getSupplierTypes } from "~/modules/purchasing";
import { SupplierAccountsTable, getSuppliers } from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Suppliers",
  to: path.to.supplierAccounts,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suppliers, supplierTypes] = await Promise.all([
    getSuppliers(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getSupplierTypes(client, companyId),
  ]);
  if (suppliers.error) {
    throw redirect(
      path.to.users,
      await flash(request, error(suppliers.error, "Error loading suppliers"))
    );
  }
  if (supplierTypes.error) {
    throw redirect(
      path.to.users,
      await flash(
        request,
        error(supplierTypes.error, "Error loading supplier types")
      )
    );
  }

  return json({
    count: suppliers.count ?? 0,
    suppliers: suppliers.data,
    supplierTypes: supplierTypes.data,
  });
}

export default function UsersSuppliersRoute() {
  const { count, suppliers, supplierTypes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SupplierAccountsTable
        data={suppliers}
        count={count}
        supplierTypes={supplierTypes}
      />
      <Outlet />
    </VStack>
  );
}
