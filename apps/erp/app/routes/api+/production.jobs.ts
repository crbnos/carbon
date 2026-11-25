// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { LoaderFunctionArgs } from "react-router";
import { jobStatus } from "~/modules/production/production.models";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "production.jobs": "View" });

  const url = new URL(request.url);
  const statuses = url.searchParams
    .getAll("status")
    .filter((status): status is Database["public"]["Enums"]["jobStatus"] =>
      jobStatus.includes(status as (typeof jobStatus)[number])
    );

  return await api.production.getJobsList({ statuses });
}
