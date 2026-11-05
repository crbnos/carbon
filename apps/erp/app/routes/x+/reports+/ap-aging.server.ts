// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime } from "@carbon/utils";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";

function parseBuckets(raw: string | null): [number, number, number] {
  const parts = (raw ?? "").split(",").map((n) => Number.parseInt(n, 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return [parts[0], parts[1], parts[2]];
  }
  return [30, 60, 90];
}

export async function resolveApAgingRequest(request: Request) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const asOfDate =
    url.searchParams.get("asOfDate") ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();
  const agingMethod: "dueDate" | "documentDate" =
    url.searchParams.get("agingMethod") === "documentDate"
      ? "documentDate"
      : "dueDate";
  const bucketDays = parseBuckets(url.searchParams.get("bucketDays"));

  return { client, companyId, asOfDate, agingMethod, bucketDays };
}
