// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCustomerContacts } from "~/modules/sales/sales.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;

  if (!customerId)
    return {
      data: []
    };

  const [contacts, customer] = await Promise.all([
    getCustomerContacts(authorized.client, customerId),
    authorized.client
      .from("customer")
      .select("requireContactEmail")
      .eq("id", customerId)
      .maybeSingle()
  ]);
  if (contacts.error) {
    return data(
      contacts,
      await flash(
        request,
        error(contacts.error, "Failed to get customer contacts")
      )
    );
  }
  if (customer.error) {
    return data(
      contacts,
      await flash(request, error(customer.error, "Failed to get customer"))
    );
  }

  return {
    ...contacts,
    requireContactEmail: customer.data?.requireContactEmail ?? false
  };
}

export const clientLoader = cachedClientLoader<typeof loader>();
