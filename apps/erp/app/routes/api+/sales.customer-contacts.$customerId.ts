import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";

import { data } from "react-router";
import { getCustomerContacts } from "~/modules/sales/sales.service.server";
import { customerContactsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const _authorized = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;

  if (!customerId)
    return {
      data: []
    };

  const contacts = await getCustomerContacts(customerId);
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
