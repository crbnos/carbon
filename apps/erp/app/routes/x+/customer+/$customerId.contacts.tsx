// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getCustomerContacts } from "~/modules/sales/sales.service";
import { CustomerContacts } from "~/modules/sales/ui/Customer";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const [contacts, customer] = await Promise.all([
    getCustomerContacts(client, customerId),
    client
      .from("customer")
      .select("requireContactEmail")
      .eq("id", customerId)
      .maybeSingle()
  ]);
  if (contacts.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(contacts.error, "Failed to fetch customer contacts")
      )
    );
  }
  if (customer.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(request, error(customer.error, "Failed to fetch customer"))
    );
  }

  return {
    contacts: contacts.data ?? [],
    requireContactEmail: customer.data?.requireContactEmail ?? false
  };
}

export default function CustomerContactsRoute() {
  const { contacts, requireContactEmail } = useLoaderData<typeof loader>();

  return (
    <CustomerContacts
      contacts={contacts}
      requireContactEmail={requireContactEmail}
    />
  );
}
