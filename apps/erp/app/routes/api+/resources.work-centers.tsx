import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getWorkCentersList } from "~/modules/resources";
import { getCompanyId, workCentersQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return await getWorkCentersList(client, companyId);
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = workCentersQuery(companyId).queryKey;
  const data = window?.clientCache?.getQueryData<typeof loader>(queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
