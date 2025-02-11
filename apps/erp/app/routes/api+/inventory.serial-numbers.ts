import { requirePermissions } from "@carbon/auth/auth.server";
import type { ClientLoaderFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs, SerializeFrom } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSerialNumbersForItem } from "~/modules/inventory/inventory.service";
import { getCompanyId, serialNumbersQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return json({
      data: [],
      error: null,
    });
  }

  return json(await getSerialNumbersForItem(client, companyId, itemId));
}

export async function clientLoader({
  request,
  serverLoader,
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");

  const queryKey = serialNumbersQuery(companyId, itemId ?? null).queryKey;
  const data =
    window?.clientCache?.getQueryData<SerializeFrom<typeof loader>>(queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
