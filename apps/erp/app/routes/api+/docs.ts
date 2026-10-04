// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import { Ratelimit, redis } from "@carbon/kv";
import { getClientIp } from "@carbon/utils";
import { data, type LoaderFunctionArgs } from "react-router";
import { cachedClientLoader, RefreshRate } from "~/utils/react-query";

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

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.Never
});
