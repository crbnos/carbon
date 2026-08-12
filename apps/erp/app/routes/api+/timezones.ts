import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getCachedTimezoneNames } from "~/modules/shared/shared.server";
import { timezonesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});
  return await getCachedTimezoneNames(client);
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const query = timezonesQuery();
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
