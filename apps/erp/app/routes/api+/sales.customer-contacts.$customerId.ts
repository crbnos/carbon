// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await authorize(request, { "sales.customers": "View" });

  const { customerId } = params;

  if (!customerId)
    return {
      data: []
    };

  const contacts = await authorized.api.sales.getCustomerContacts({
    customerId
  });
  if (contacts.error) {
    return data(
      contacts,
      await flash(
        request,
        error(contacts.error, "Failed to get customer contacts")
      )
    );
  }

  return contacts;
}

export const clientLoader = cachedClientLoader<typeof loader>();
