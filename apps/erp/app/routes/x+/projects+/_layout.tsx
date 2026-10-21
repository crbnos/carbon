// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { GroupedContentSidebar } from "~/components/Layout";
import {
  getApprovalCountForUser,
  getBillingReviewCountForUser
} from "~/modules/projects/projects.server";
import useProjectsSubmodules from "~/modules/projects/ui/useProjectsSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Projects" }];
};

function ProjectsSidebar() {
  const { groups } = useProjectsSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Projects`,
  to: path.to.projects,
  module: "projects",
  sidebar: ProjectsSidebar
};

// Each page checks its own permission; the layout only signs the user in and
// reads the Approvals counts for the sidebar.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  // Approvals counts submitted time and the contract billable items that
  // wait for review.
  const [approvalCount, billingReviewCount] = await Promise.all([
    getApprovalCountForUser(client, { companyId, userId }),
    getBillingReviewCountForUser(client, { companyId, userId })
  ]);
  return { approvalCount, billingReviewCount };
}

export default function ProjectsRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <RecordOutlet />
    </VStack>
  );
}
