import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getSupplier,
  getSupplierContacts,
  getSupplierLocations,
} from "~/modules/purchasing";
import SupplierHeader from "~/modules/purchasing/ui/Supplier/SupplierHeader";
import SupplierSidebar from "~/modules/purchasing/ui/Supplier/SupplierSidebar";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Suppliers",
  to: path.to.suppliers,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const [supplier, contacts, locations] = await Promise.all([
    getSupplier(client, supplierId),
    getSupplierContacts(client, supplierId),
    getSupplierLocations(client, supplierId),
  ]);

  if (supplier.error) {
    throw redirect(
      path.to.suppliers,
      await flash(
        request,
        error(supplier.error, "Failed to load supplier summary")
      )
    );
  }

  return json({
    supplier: supplier.data,
    contacts: contacts.data ?? [],
    locations: locations.data ?? [],
  });
}

export default function SupplierRoute() {
  return (
    <>
      <SupplierHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <SupplierSidebar />
        <Outlet />
      </div>
    </>
  );
}
