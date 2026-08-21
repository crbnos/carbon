import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { getShippingTermsList } from "~/modules/inventory";
import { getSupplierTypes } from "~/modules/purchasing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Supplier" }];
};

export const handle: Handle = {
  breadcrumb: msg`Purchasing`,
  to: path.to.purchasing,
  module: "purchasing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const [
    supplierTypes
    // shippingTerms,
  ] = await Promise.all([
    getSupplierTypes(client, companyId),
    getShippingTermsList(client, companyId)
  ]);

  return {
    supplierTypes: supplierTypes.data ?? []
    // shippingTerms: shippingTerms.data ?? [],
  };
}

export default function SupplierRoute() {
  return (
    <div className="flex h-full w-full justify-center bg-card">
      <VStack spacing={4} className="h-full p-4 w-full max-w-[80rem]">
        <Outlet />
      </VStack>
    </div>
  );
}
