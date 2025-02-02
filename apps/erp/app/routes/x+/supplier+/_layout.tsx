import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getShippingTermsList } from "~/modules/inventory";
import { getSupplierStatuses, getSupplierTypes } from "~/modules/purchasing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Supplier" }];
};

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.purchasing,
  module: "purchasing",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const [
    supplierTypes,
    supplierStatuses,
    // shippingTerms,
  ] = await Promise.all([
    getSupplierTypes(client, companyId),
    getSupplierStatuses(client, companyId),
    getShippingTermsList(client, companyId),
  ]);

  return json({
    supplierStatuses: supplierStatuses.data ?? [],
    supplierTypes: supplierTypes.data ?? [],
    // shippingTerms: shippingTerms.data ?? [],
  });
}

export default function SupplierRoute() {
  return (
    <div className="flex h-full w-full justify-center bg-muted">
      <VStack spacing={4} className="h-full p-4 w-full max-w-[80rem]">
        <Outlet />
      </VStack>
    </div>
  );
}
