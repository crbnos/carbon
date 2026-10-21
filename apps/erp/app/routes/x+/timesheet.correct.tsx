// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { timesheetCorrectionValidator } from "~/modules/projects/projects.models";
import { postTimesheetEntries } from "~/modules/projects/projects.server";
import { createTimesheetCorrection } from "~/modules/projects/projects.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-timesheet-correct");

/**
 * Corrects one of the signed-in user's posted entries: a reversal of the
 * posted hours and the new hours, both Submitted. The new hours can move to
 * another charge number and labor category (a labor transfer). With
 * approvals off both post at once, except a labor transfer in DCAA mode,
 * which always waits for another user's approval. A refusal is returned as
 * fetcher data, so the modal shows it.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const validation = await validator(timesheetCorrectionValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  // The correction runs over Kysely (no RLS), so the entry must be the
  // user's own.
  const entry = await client
    .from("timesheetEntry")
    .select("id")
    .eq("id", validation.data.timesheetEntryId)
    .eq("companyId", companyId)
    .eq("employeeId", userId)
    .maybeSingle();
  if (entry.error || !entry.data) {
    return data({
      success: false,
      error: { message: "The timesheet entry does not exist" }
    });
  }

  let correction: Awaited<ReturnType<typeof createTimesheetCorrection>>;
  try {
    correction = await createTimesheetCorrection(getDatabaseClient(), {
      ...validation.data,
      companyId,
      userId
    });
  } catch (err) {
    logger.error("Failed to correct a timesheet entry", {
      companyId,
      error: err
    });
    return data({
      success: false,
      error: {
        message:
          err instanceof Error ? err.message : "Failed to correct the entry"
      }
    });
  }

  const settings = await getCompanySettings(client, companyId);
  if (settings.error) {
    logger.error("Failed to load company settings", {
      companyId,
      error: settings.error
    });
  }
  // DCAA mode: a labor transfer needs an approver other than the requester
  // (`assertCanApprove`), so it never posts on its own.
  if (correction.isTransfer && settings.data?.timekeepingControls === "DCAA") {
    return data(
      { success: true, error: null },
      await flash(request, success("The transfer waits for approval"))
    );
  }
  if (settings.data?.timesheetApprovalRequired ?? true) {
    return data(
      { success: true, error: null },
      await flash(request, success("Correction submitted for approval"))
    );
  }

  const postingError = await postTimesheetEntries({
    timesheetEntryIds: [
      correction.reversalId,
      ...(correction.replacementId ? [correction.replacementId] : [])
    ],
    companyId,
    userId
  });
  if (postingError) {
    return data(
      {
        success: false,
        error: {
          message: `The correction is submitted but did not post: ${postingError}`
        }
      },
      await flash(request, error(null, postingError))
    );
  }

  return data(
    { success: true, error: null },
    await flash(request, success("Correction posted"))
  );
}
