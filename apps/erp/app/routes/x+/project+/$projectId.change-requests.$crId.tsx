// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  canApproveRequest,
  getLatestApprovalRequestForDocument
} from "@carbon/ee/approvals.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { getChangeRequestReview } from "~/modules/projects/projects.server";
import ChangeRequestReview from "~/modules/projects/ui/ChangeRequests/ChangeRequestReview";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-change-request");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId, crId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!crId) throw new Error("Could not find crId");

  const [review, latest] = await Promise.all([
    getChangeRequestReview(client, {
      companyId,
      projectId,
      changeRequestId: crId,
      userId
    }),
    getLatestApprovalRequestForDocument(
      getCarbonServiceRole(),
      "projectChangeRequest",
      crId
    )
  ]);
  if (review.error || !review.data) {
    logger.error("Failed to load the change request", {
      companyId,
      projectId,
      changeRequestId: crId,
      error: review.error
    });
    throw redirect(
      path.to.projectChangeRequests(projectId),
      await flash(
        request,
        error(review.error, "Failed to load the change request")
      )
    );
  }

  // With a pending approval request, only its approvers decide. Without one,
  // a user with `update: projects` decides (the page reads the permission).
  const pending =
    latest.data && latest.data.companyId === companyId ? latest.data : null;
  const pendingApprover = pending
    ? await canApproveRequest(
        getCarbonServiceRole(),
        {
          amount: pending.amount,
          documentType: pending.documentType,
          companyId: pending.companyId
        },
        userId
      )
    : null;

  return { review: review.data, pendingApprover };
}

export default function ProjectChangeRequestRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const { review, pendingApprover } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "projects");

  return (
    <ChangeRequestReview
      key={review.changeRequest.id}
      projectId={projectId}
      review={review}
      canDecide={pendingApprover ?? canUpdate}
      canUpdate={canUpdate}
    />
  );
}
