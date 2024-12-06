import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getCustomer,
  getCustomerContacts,
  getCustomerLocations,
} from "~/modules/sales";
import { CustomerHeader, CustomerSidebar } from "~/modules/sales/ui/Customer";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Customers",
  to: path.to.customers,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const [customer, contacts, locations] = await Promise.all([
    getCustomer(client, customerId),
    getCustomerContacts(client, customerId),
    getCustomerLocations(client, customerId),
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

  return json({
    customer: customer.data,
    contacts: contacts.data ?? [],
    locations: locations.data ?? [],
  });
}

export default function CustomerRoute() {
  return (
    <>
      <CustomerHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <CustomerSidebar />
        <Outlet />
      </div>
    </>
  );
}
