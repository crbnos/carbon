// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getScrappableParts,
  groupScrappableParts
} from "@carbon/database/scrappable-parts";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { erpPosting } from "~/services/erp";
import { scrapApproverValidator, scrapPartsValidator } from "~/services/models";
import { abilityBlockRefusal } from "~/services/operations.service";
import { postScrapWithApproval } from "~/services/scrap-approval.server";

/** The parts an operator can scrap at an operation and replace from the shelf. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const { operationId } = params;
  if (!operationId) throw new Response("Missing operation", { status: 400 });

  const operation = await getScrappableParts(getDatabaseClient(), {
    companyId,
    jobOperationId: operationId
  });
  if (!operation) throw new Response("Operation not found", { status: 404 });
  return { parts: groupScrappableParts(operation.materials) };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId, userId, sessionUserId } = await requirePermissions(
    request,
    {}
  );
  const { operationId } = params;
  if (!operationId) throw new Response("Missing operation", { status: 400 });

  const formData = await request.formData();
  const validation = await validator(scrapPartsValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const refusal = await abilityBlockRefusal(getCarbonServiceRole(), {
    operationId,
    employeeId: userId,
    companyId
  });
  if (refusal) {
    return data({ success: false, message: refusal }, { status: 403 });
  }

  const { lines, scrapReasonId, notes, idempotencyKey } = validation.data;
  // The posting books a key once: a key with rows is a scrap that posted.
  const booked = () => scrapPartsBooked(companyId, idempotencyKey);
  const approver = await validator(scrapApproverValidator).validate(formData);
  const outcome = await postScrapWithApproval({
    request,
    companyId,
    userId,
    sessionUserId,
    subject: {
      type: "parts",
      jobOperationId: operationId,
      lines,
      scrapReasonId,
      notes
    },
    approver: approver.error ? {} : approver.data,
    // The lines are the quantities valued: the posting scraps exactly them.
    post: () =>
      erpPosting(
        "issue",
        { companyId, userId },
        {
          type: "scrapJobPart",
          ...validation.data,
          jobOperationId: operationId
        }
      ),
    // A resent request of a scrap that posted books nothing, so it asks for
    // no approval and records none.
    alreadyApproved: async () =>
      (await booked()) ? { scrapRequestId: null } : null,
    postedDespiteError: booked
  });

  if (outcome.status === "approval-required") {
    return { scrapApproval: outcome.prompt };
  }

  if (outcome.status === "refused") {
    const status = refusedStatus(outcome.error);
    return data(
      {
        success: false,
        message:
          status < 500 && outcome.message
            ? outcome.message
            : "Failed to scrap the parts"
      },
      { status }
    );
  }

  return { success: true, message: "Scrapped" };
}

/** Whether the scrapJobPart posting booked this idempotency key. */
async function scrapPartsBooked(
  companyId: string,
  idempotencyKey: string
): Promise<boolean> {
  const row = await getDatabaseClient()
    .selectFrom("jobMaterialScrap")
    .select("id")
    .where("companyId", "=", companyId)
    .where("idempotencyKey", "=", idempotencyKey)
    .executeTakeFirst();
  return !!row;
}

/** The posting's own status, else 400: a check that refused without one. */
function refusedStatus(error: unknown): number {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  return typeof status === "number" ? status : 400;
}
