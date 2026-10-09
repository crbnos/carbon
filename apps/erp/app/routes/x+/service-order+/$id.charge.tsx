// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, hasPermission, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { logTimeValidator, projectIssueValidator } from "~/modules/projects";
import {
  postProjectIssue,
  postTimesheetEntries
} from "~/modules/projects/projects.server";
import {
  coverageOverrideValidator,
  serviceChargeReversalValidator,
  serviceExpenseValidator
} from "~/modules/service";
import {
  addServiceExpense,
  logServiceTime,
  reclassServiceCharge,
  requireOwnServiceVisit,
  requireServiceOrderNode,
  reverseServiceCharge,
  ServiceOrderError
} from "~/modules/service/service.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "service-order-charge");

function refuse(message: string) {
  return data({ success: false, error: { message } });
}

const MESSAGES = {
  time: "Time logged",
  part: "Part issued",
  expense: "Expense added",
  reclass: "Coverage changed",
  reverse: "Charge reversed"
} as const;

/**
 * Charges a service order's node, switching on `intent`:
 * - `time`: a Draft timesheet entry on the node (with the visit), posted at
 *   once by `post-timesheet`;
 * - `part`: an issue or a return through `post-project-issue`;
 * - `expense`: a `projectExpenseEntry`, posted by `post-project-expense`;
 * - `reclass`: a charge moved to another coverage, with a reason, through
 *   `reclass-project-coverage`;
 * - `reverse`: a posted time or expense charge reversed, with a reason (a
 *   timesheet correction through `post-timesheet`, or an expense reversal
 *   through `post-project-expense`).
 * A user without `update: "service"` charges and reverses only on their own
 * open visit (the form's `serviceVisitId`) and never reclasses.
 * A refusal is returned as fetcher data, so the modal shows it and stays open.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (
    intent !== "time" &&
    intent !== "part" &&
    intent !== "expense" &&
    intent !== "reclass" &&
    intent !== "reverse"
  ) {
    return refuse("Unknown charge");
  }

  // A part moves stock, so it also needs inventory rights. A technician
  // without `update: "service"` charges only their own open visit.
  const { companyId, userId } = await requirePermissions(request, {
    view: "service",
    ...(intent === "part" ? { update: "inventory" } : {})
  });
  const db = getDatabaseClient();
  const serviceVisitId = formData.get("serviceVisitId");
  const visitId =
    typeof serviceVisitId === "string" && serviceVisitId
      ? serviceVisitId
      : null;
  const canUpdateAny = hasPermission(
    (await getUserClaims(userId, companyId))?.permissions,
    "service",
    "update",
    companyId
  );

  try {
    if (!canUpdateAny) {
      if (intent === "reclass") {
        return refuse("You do not have permission to change a coverage");
      }
      await requireOwnServiceVisit(db, {
        companyId,
        serviceOrderId: id,
        serviceVisitId: visitId,
        userId
      });
    }
    if (intent === "time") {
      const validation = await validator(logTimeValidator).validate(formData);
      if (validation.error) return validationError(validation.error);
      const order = await requireServiceOrderNode(db, {
        companyId,
        serviceOrderId: id,
        projectElementId: validation.data.projectElementId
      });
      if (order.projectId !== validation.data.projectId) {
        return refuse("The time is not for this service order");
      }
      const entryId = await logServiceTime(db, {
        companyId,
        userId,
        projectId: order.projectId,
        projectElementId: validation.data.projectElementId ?? null,
        serviceVisitId: visitId,
        laborCategoryId: validation.data.laborCategoryId,
        entryDate: validation.data.entryDate,
        hours: validation.data.hours,
        note: validation.data.note ?? null
      });
      const postingError = await postTimesheetEntries({
        timesheetEntryIds: [entryId],
        companyId,
        userId
      });
      if (postingError) {
        return refuse(`The time is logged but did not post: ${postingError}`);
      }
    } else if (intent === "part") {
      const validation = await validator(projectIssueValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const order = await requireServiceOrderNode(db, {
        companyId,
        serviceOrderId: id,
        projectElementId: validation.data.projectElementId
      });
      if (order.projectId !== validation.data.projectId) {
        return refuse("The part is not for this service order");
      }
      const postingError = await postProjectIssue({
        ...validation.data,
        companyId,
        userId
      });
      if (postingError) return refuse(postingError);
    } else if (intent === "expense") {
      const validation = await validator(serviceExpenseValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const order = await requireServiceOrderNode(db, {
        companyId,
        serviceOrderId: id,
        projectElementId: validation.data.projectElementId
      });
      const postingError = await addServiceExpense(db, {
        ...validation.data,
        serviceVisitId: visitId ?? undefined,
        companyId,
        userId,
        projectId: order.projectId
      });
      if (postingError) return refuse(postingError);
    } else if (intent === "reverse") {
      const validation = await validator(
        serviceChargeReversalValidator
      ).validate(formData);
      if (validation.error) return validationError(validation.error);
      const order = await requireServiceOrderNode(db, {
        companyId,
        serviceOrderId: id
      });
      const postingError = await reverseServiceCharge(db, {
        ...validation.data,
        companyId,
        userId,
        projectId: order.projectId,
        onlyVisitId: canUpdateAny ? null : visitId
      });
      if (postingError) return refuse(postingError);
    } else {
      const validation = await validator(coverageOverrideValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const projectLedgerId = formData.get("projectLedgerId");
      if (typeof projectLedgerId !== "string" || !projectLedgerId) {
        return refuse("Choose a charge");
      }
      const order = await requireServiceOrderNode(db, {
        companyId,
        serviceOrderId: id
      });
      const charge = await db
        .selectFrom("projectLedger")
        .select("id")
        .where("id", "=", projectLedgerId)
        .where("projectId", "=", order.projectId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!charge) return refuse("The charge is not on this service order");
      const postingError = await reclassServiceCharge(db, {
        ...validation.data,
        companyId,
        userId,
        projectLedgerId
      });
      if (postingError) return refuse(postingError);
    }
  } catch (err) {
    if (err instanceof ServiceOrderError) return refuse(err.message);
    logger.error("Failed to charge the service order", {
      companyId,
      serviceOrderId: id,
      intent,
      error: err
    });
    return refuse("Failed to post the charge");
  }

  return data(
    { success: true, error: null },
    await flash(request, success(MESSAGES[intent]))
  );
}
