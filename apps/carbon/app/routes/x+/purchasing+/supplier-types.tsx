import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { SupplierTypesTable, getSupplierTypes } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Supplier Types",
  to: path.to.supplierTypes,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts } = getGenericQueryFilters(searchParams);

  return json(
    await getSupplierTypes(client, companyId, { search, limit, offset, sorts })
  );
}

export default function SupplierTypesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SupplierTypesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
