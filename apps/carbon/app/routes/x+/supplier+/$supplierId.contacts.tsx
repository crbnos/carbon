import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { SupplierContacts, getSupplierContacts } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const contacts = await getSupplierContacts(client, supplierId);
  if (contacts.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(contacts.error, "Failed to fetch supplier contacts")
      )
    );
  }

  return json({
    contacts: contacts.data ?? [],
  });
}

export default function SupplierContactsRoute() {
  const { contacts } = useLoaderData<typeof loader>();

  return <SupplierContacts contacts={contacts} />;
}
