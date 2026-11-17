// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getMaterialRequestOptions } from "~/services/material-request.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const params = new URL(request.url).searchParams;
  const jobOperationId = params.get("jobOperationId");
  if (!jobOperationId) {
    return data({ options: [], error: "Missing jobOperationId" }, 400);
  }

  const options = await getMaterialRequestOptions(client, {
    companyId,
    jobOperationId,
    search: params.get("search") ?? ""
  });
  if (options.error || !options.data) {
    return data({ options: [], error: options.error }, 500);
  }
  return { options: options.data, error: null };
}
