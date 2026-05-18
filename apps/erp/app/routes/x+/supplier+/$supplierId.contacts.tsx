import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getSupplierContacts } from "~/modules/purchasing";
import SupplierContacts from "~/modules/purchasing/ui/Supplier/SupplierContacts";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const contacts = await getSupplierContacts(supplierId);
  if (contacts.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(contacts.error, "Failed to fetch supplier contacts")
      )
    );
  }

  return {
    contacts: contacts.data ?? []
  };
}

export default function SupplierContactsRoute() {
  const { contacts } = useLoaderData<typeof loader>();

  return <SupplierContacts contacts={contacts} />;
}
