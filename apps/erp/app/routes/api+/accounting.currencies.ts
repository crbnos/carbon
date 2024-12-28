import { requirePermissions } from "@carbon/auth/auth.server";
import type { ClientLoaderFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs, SerializeFrom } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCurrenciesList } from "~/modules/accounting";
import { currenciesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  return json(await getCurrenciesList(client));
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const query = currenciesQuery();
  const data = window?.clientCache?.getQueryData<SerializeFrom<typeof loader>>(
    query.queryKey
  );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(query.queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
