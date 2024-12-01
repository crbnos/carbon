import { requirePermissions } from "@carbon/auth/auth.server";
import type { ClientLoaderFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs, SerializeFrom } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCountries } from "~/modules/shared";
import { countriesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});
  return json(await getCountries(client));
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const query = countriesQuery();
  const data = window?.queryClient?.getQueryData<SerializeFrom<typeof loader>>(
    query.queryKey
  );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.queryClient?.setQueryData(query.queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
