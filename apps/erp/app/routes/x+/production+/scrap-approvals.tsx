// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getScrapApprovals } from "@carbon/ee/approvals/scrap.server";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import ScrapApprovalsTable from "~/modules/production/ui/ScrapApprovals/ScrapApprovalsTable.ee";
import { ApprovalRulesUpgradeOverlay } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Scrap Approvals`,
  to: path.to.scrapApprovals
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const { limit, offset } = getGenericQueryFilters(
    new URLSearchParams(url.search)
  );

  // The decision lives on `approvalRequest`, which has no API-role policy,
  // so the list reads with the service role, scoped to the company.
  const approvals = await getScrapApprovals(getCarbonServiceRole(), companyId, {
    limit,
    offset
  });

  if (approvals.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(approvals.error, "Failed to load scrap approvals")
      )
    );
  }

  return {
    approvals: approvals.data ?? [],
    count: approvals.count ?? 0
  };
}

export default function ScrapApprovalsRoute() {
  const { approvals, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "APPROVAL_RULES" });

  if (isGated) {
    return <ApprovalRulesUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <ScrapApprovalsTable data={approvals} count={count} />
    </VStack>
  );
}
