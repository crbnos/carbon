import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { getCustomerStatuses, getCustomerTypes } from "~/modules/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Customer" }];
};

export const handle: Handle = {
  breadcrumb: msg`Sales`,
  to: path.to.sales,
  module: "sales"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const [
    customerTypes,
    customerStatuses
    // shippingTerms,
  ] = await Promise.all([
    getCustomerTypes(client, companyId),
    getCustomerStatuses(client, companyId)

    // getShippingTermsList(client, companyId),
  ]);

  return {
    customerStatuses: customerStatuses.data ?? [],
    customerTypes: customerTypes.data ?? []
    // shippingTerms: shippingTerms.data ?? [],
  };
}

export default function CustomerRoute() {
  return (
    <div className="flex h-full w-full justify-center bg-card">
      <VStack spacing={4} className="h-full p-4 w-full max-w-[80rem]">
        <Outlet />
      </VStack>
    </div>
  );
}
