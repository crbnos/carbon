import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getCustomerContacts } from "~/modules/sales";
import { CustomerContacts } from "~/modules/sales/ui/Customer";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const contacts = await getCustomerContacts(client, customerId);
  if (contacts.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(contacts.error, "Failed to fetch customer contacts")
      )
    );
  }

  return json({
    contacts: contacts.data ?? [],
  });
}

export default function CustomerContactsRoute() {
  const { contacts } = useLoaderData<typeof loader>();

  return <CustomerContacts contacts={contacts} />;
}
