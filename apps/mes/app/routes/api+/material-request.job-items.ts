// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getJobRequestItems } from "~/services/material-request.service";

const logger = getLogger("mes", "material-request-job-items");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await authorize(request, {});

  const jobOperationId = new URL(request.url).searchParams.get(
    "jobOperationId"
  );
  if (!jobOperationId) return data({ items: [] }, 400);

  const items = await getJobRequestItems(client, { companyId, jobOperationId });
  if (items.error || !items.data) {
    logger.error("Failed to load the job's requestable items", {
      companyId,
      jobOperationId,
      error: items.error
    });
    return data({ items: [] }, 500);
  }
  return { items: items.data };
}
