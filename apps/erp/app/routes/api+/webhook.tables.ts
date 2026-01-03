import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getWebhookTables } from "~/modules/settings/settings.service";
import { getCompanyId, webhookTablesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  return await getWebhookTables(client);
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = webhookTablesQuery().queryKey;
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
