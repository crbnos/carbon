import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data } from "react-router";
import { getSupplierContacts } from "~/modules/purchasing";
import { supplierContactsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;

  if (!supplierId)
    return {
      data: []
    };

  const contacts = await getSupplierContacts(authorized.client, supplierId);
  if (contacts.error) {
    return data(
      contacts,
      await flash(
        request,
        error(contacts.error, "Failed to get supplier contacts")
      )
    );
  }

  return contacts;
}

export async function clientLoader({
  serverLoader,
  params
}: ClientLoaderFunctionArgs) {
  const { supplierId } = params;

  if (!supplierId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = supplierContactsQuery(supplierId).queryKey;
  const data =
    window?.clientCache?.getQueryData<Awaited<ReturnType<typeof loader>>>(
      queryKey
    );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
