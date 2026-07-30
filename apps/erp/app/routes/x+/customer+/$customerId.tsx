import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { cn } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";
import { usePermissions } from "~/hooks";
import {
  getCustomer,
  getCustomerContacts,
  getCustomerLocations,
  getCustomerTax
} from "~/modules/sales";
import { CustomerHeader, CustomerSidebar } from "~/modules/sales/ui/Customer";
import { getTagsList } from "~/modules/shared";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Customers`, to: path.to.customers },
    (data) => data?.customer?.name
  )
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const [customer, contacts, locations, tags, customerTax] = await Promise.all([
    getCustomer(client, customerId),
    getCustomerContacts(client, customerId),
    getCustomerLocations(client, customerId),
    getTagsList(client, companyId, "customer"),
    getCustomerTax(client, customerId)
  ]);

  if (customer.error) {
    throw redirect(
      path.to.customers,
      await flash(
        request,
        error(customer.error, "Failed to load customer summary")
      )
    );
  }

  return {
    customer: customer.data,
    contacts: contacts.data ?? [],
    locations: locations.data ?? [],
    tags: tags.data ?? [],
    customerTax: customerTax.data
  };
}

export default function CustomerRoute() {
  const permissions = usePermissions();
  const isEmployee = permissions.is("employee");
  return (
    <>
      <CustomerHeader />
      <div
        className={cn("grid grid-cols-1 h-full w-full gap-4", {
          "md:grid-cols-[1fr_4fr]": isEmployee
        })}
      >
        {isEmployee && <CustomerSidebar />}
        <Outlet />
      </div>
    </>
  );
}
