import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getShelvesListForLocation } from "~/modules/inventory";
import { getCompanyId, shelvesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  if (!locationId) {
    return {
      data: [],
      error: null
    };
  }

  return await getShelvesListForLocation(client, companyId, locationId);
}

export async function clientLoader({
  request,
  serverLoader
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");

  const queryKey = shelvesQuery(companyId, locationId ?? null).queryKey;
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
