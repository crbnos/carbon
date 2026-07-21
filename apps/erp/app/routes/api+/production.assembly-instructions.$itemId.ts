import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data } from "react-router";
import { getAssemblyInstructionsForItem } from "~/modules/production";
import { assemblyInstructionsQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { itemId } = params;
  if (!itemId) {
    return data({ error: "Item ID is required" }, { status: 400 });
  }

  return await getAssemblyInstructionsForItem(client, itemId, companyId);
}

export async function clientLoader({
  params,
  serverLoader
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId || !params.itemId) {
    return await serverLoader<typeof loader>();
  }

  const query = assemblyInstructionsQuery(params.itemId, companyId);
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
