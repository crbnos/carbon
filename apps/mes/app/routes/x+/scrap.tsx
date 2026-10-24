// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { erpPosting } from "~/services/erp";
import {
  scrapApproverValidator,
  scrapQuantityValidator
} from "~/services/models";
import { postScrapWithApproval } from "~/services/scrap-approval.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId, sessionUserId } = await requirePermissions(
    request,
    {}
  );

  const formData = await request.formData();
  const validation = await validator(scrapQuantityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    trackedEntityId,
    trackingType,
    jobOperationId,
    quantity,
    scrapReasonId,
    notes,
    setupProductionEventId,
    laborProductionEventId,
    machineProductionEventId
  } = validation.data;
  const scrapEntityId = trackingType === "Serial" ? trackedEntityId : undefined;
  const approver = await validator(scrapApproverValidator).validate(formData);

  // One transactional posting: Scrap productionQuantity row, BOM
  // backflush, tracked-entity terminal status + replacement serial spawn
  // (serial parents), Done-operation reopen / capacity top-up beyond the
  // planned allowance, and the WIP→scrap journal. A scrap approval rule puts
  // an approver's PIN in front of it.
  const outcome = await postScrapWithApproval({
    request,
    companyId,
    userId,
    sessionUserId,
    subject: {
      type: "operation",
      jobOperationId,
      quantity,
      trackedEntityId: scrapEntityId,
      scrapReasonId,
      notes
    },
    approver: approver.error ? {} : approver.data,
    post: () =>
      erpPosting(
        "issue",
        { companyId, userId },
        {
          type: "jobOperationScrap",
          jobOperationId,
          quantity,
          scrapReasonId,
          notes,
          setupProductionEventId,
          laborProductionEventId,
          machineProductionEventId,
          trackedEntityId: scrapEntityId
        }
      )
  });

  if (outcome.status === "approval-required") {
    return { scrapApproval: outcome.prompt };
  }

  if (outcome.status === "refused") {
    return data(
      {},
      await flash(
        request,
        error(
          outcome.error ?? null,
          outcome.message || "Failed to record scrap quantity"
        )
      )
    );
  }

  // The client (useOperation / AssemblyView) advances to the spawned
  // replacement serial the same way the complete flow does.
  return data(
    { scrapped: true, newTrackedEntityId: outcome.data?.newTrackedEntityId },
    await flash(request, success("Scrap quantity recorded successfully"))
  );
}
