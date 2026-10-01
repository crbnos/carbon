// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";

import { data } from "react-router";
import { getCustomerContacts } from "~/modules/sales";
import { customerContactsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;

  if (!customerId)
    return {
      data: []
    };

  const contacts = await getCustomerContacts(authorized.client, customerId);
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

export async function clientLoader({
  serverLoader,
  params
}: ClientLoaderFunctionArgs) {
  const { customerId } = params;

  if (!customerId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = customerContactsQuery(customerId).queryKey;
  const data = window?.clientCache?.getQueryData<typeof loader>(queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
