import { requirePermissions } from "@carbon/auth/auth.server";
import type { ClientLoaderFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs, SerializeFrom } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getUnitOfMeasuresList } from "~/modules/items";
import { getCompanyId, queryClient, uomsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return json(await getUnitOfMeasuresList(client, companyId));
}

export async function clientLoader({
  serverLoader,
  params,
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();
  console.log("companyId", companyId);
  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const query = uomsQuery(companyId);
  const data = queryClient.getQueryData<SerializeFrom<typeof loader>>(
    query.queryKey
  );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    queryClient.setQueryData(query.queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
