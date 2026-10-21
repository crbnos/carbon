// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { accountMoveDate } from "@carbon/lib/system-status";
import { getSystemStatus } from "@carbon/lib/system-status.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader, RefreshRate } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "system-status");

// The deployment's status document (latest version, announcement; empty when
// SYSTEM_STATUS_URL is unset), plus the day the signed-in company's account
// moves to another instance, if one is set on it.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const [status, company] = await Promise.all([
    getSystemStatus(),
    client.from("company").select("dimensions").eq("id", companyId).single()
  ]);
  if (company.error) {
    logger.error("Failed to load the company's account-move date", {
      companyId,
      error: company.error
    });
  }
  return {
    announcement: status?.announcement ?? null,
    latestVersion: status?.latestVersion ?? null,
    accountMoveDate: accountMoveDate(company.data?.dimensions)
  };
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.High
});
