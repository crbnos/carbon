import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getCountries } from "~/modules/shared";
import { countriesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});
  return await getCountries(client);
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const query = countriesQuery();
  const data = window?.clientCache?.getQueryData<
    Awaited<ReturnType<typeof loader>>
  >(query.queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(query.queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
