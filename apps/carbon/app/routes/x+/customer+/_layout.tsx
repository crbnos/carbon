import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { getCustomerStatuses, getCustomerTypes } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Customer" }];
};

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.quotes,
  module: "sales",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const [
    customerTypes,
    customerStatuses,
    // shippingTerms,
  ] = await Promise.all([
    getCustomerTypes(client, companyId),
    getCustomerStatuses(client, companyId),

    // getShippingTermsList(client, companyId),
  ]);

  return json({
    customerStatuses: customerStatuses.data ?? [],
    customerTypes: customerTypes.data ?? [],
    // shippingTerms: shippingTerms.data ?? [],
  });
}

export default function CustomerRoute() {
  return (
    <VStack spacing={4} className="h-full p-2">
      <Outlet />
    </VStack>
  );
}
