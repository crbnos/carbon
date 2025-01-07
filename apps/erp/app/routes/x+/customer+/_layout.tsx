import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCustomerStatuses, getCustomerTypes } from "~/modules/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Customer" }];
};

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.sales,
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
    <div className="flex h-full w-full justify-center bg-muted">
      <VStack spacing={4} className="h-full p-2 w-full max-w-[80rem]">
        <Outlet />
      </VStack>
    </div>
  );
}
