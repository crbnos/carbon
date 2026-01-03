import { requirePermissions } from "@carbon/auth/auth.server";
import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { docsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  return swaggerDocsSchema;
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const queryKey = docsQuery().queryKey;
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
