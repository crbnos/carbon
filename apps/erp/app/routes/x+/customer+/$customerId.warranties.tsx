import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getCustomerWarrantyTerms } from "~/modules/sales";
import CustomerWarranties from "~/modules/sales/ui/Customer/CustomerWarranties";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Warranties`,
  to: path.to.customers
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const rules = await getCustomerWarrantyTerms(client, customerId, companyId);

  return { rules: rules.data ?? [] };
}

export default function CustomerWarrantiesRoute() {
  const { rules } = useLoaderData<typeof loader>();

  return (
    <>
      <CustomerWarranties rules={rules} />
      <Outlet />
    </>
  );
}
