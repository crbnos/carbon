import { requirePermissions } from "@carbon/auth/auth.server";
import type { ClientLoaderFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs, SerializeFrom } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getMaterialTypeList } from "~/modules/items";
import { getCompanyId, materialTypesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  if (!params.substanceId || !params.formId) {
    return json(
      { error: "Substance ID and Form ID are required" },
      { status: 400 }
    );
  }

  return json(
    await getMaterialTypeList(
      client,
      params.substanceId,
      params.formId,
      companyId
    )
  );
}

export async function clientLoader({
  params,
  serverLoader,
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId || !params.substanceId || !params.formId) {
    return await serverLoader<typeof loader>();
  }

  const query = materialTypesQuery(
    params.substanceId,
    params.formId,
    companyId
  );
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
