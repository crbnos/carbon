import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getShippingMethodsList } from "~/modules/inventory";
import { getCompanyId, shippingMethodsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return await getShippingMethodsList(client, companyId);
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = shippingMethodsQuery(companyId).queryKey;
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
