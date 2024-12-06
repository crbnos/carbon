import { requirePermissions } from "@carbon/auth/auth.server";
import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import type { ClientLoaderFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs, SerializeFrom } from "@vercel/remix";
import { json } from "@vercel/remix";
import { docsQuery } from "~/utils/react-query";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  return json(swaggerDocsSchema);
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const queryKey = docsQuery().queryKey;
  const data =
    window?.clientCache?.getQueryData<SerializeFrom<typeof loader>>(queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
