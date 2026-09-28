import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import { Ratelimit, redis } from "@carbon/kv";
import { getClientIp } from "@carbon/utils";
import {
  type ClientLoaderFunctionArgs,
  data,
  type LoaderFunctionArgs
} from "react-router";
import { docsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const ip = getClientIp(request) ?? "127.0.0.1";
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "1 h"),
    analytics: true
  });
  const { success } = await ratelimit.limit(`docs:${ip}`);

  if (!success) {
    throw data({ error: "Rate limit exceeded" }, { status: 429 });
  }

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
