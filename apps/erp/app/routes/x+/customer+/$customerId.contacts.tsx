import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getCustomerContacts } from "~/modules/sales/sales.service.server";
import { CustomerContacts } from "~/modules/sales/ui/Customer";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const contacts = await getCustomerContacts(customerId);
  if (contacts.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(contacts.error, "Failed to fetch customer contacts")
      )
    );
  }

  return {
    contacts: contacts.data ?? []
  };
}

export default function CustomerContactsRoute() {
  const { contacts } = useLoaderData<typeof loader>();

  return <CustomerContacts contacts={contacts} />;
}
