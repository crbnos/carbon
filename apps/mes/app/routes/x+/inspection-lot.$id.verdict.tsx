// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dispositionInspection,
  isInspectionClosed
} from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { erpPosting } from "~/services/erp";
import { inspectionVerdictValidator } from "~/services/models";
import { readOrigin, withOrigin } from "~/utils/origin";
import { path } from "~/utils/path";

const logger = getLogger("mes", "inspection-verdict");

// Accept or Reject a receipt or manual inspection, each one-shot like every
// MES disposition. Accept releases the lot's tracked entities in the engine.
// Reject is the ERP's own Reject Lot, sent as the `reject-inspection` posting: it
// also writes off an untracked Inventory item and opens the NCR, which are
// ERP code. Neither carries a production posting.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionVerdictValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { decision, reason, createNcr } = validation.data;
  const origin = readOrigin(formData);
  const back = withOrigin(path.to.manualInspection(id), origin);

  if (decision === "Accept") {
    const result = await dispositionInspection(getDatabaseClient(), {
      id,
      decision,
      reason,
      companyId,
      dispositionedBy: userId,
      requireSource: ["Receipt", "Manual"],
      requireOpen: true
    });
    if (result.error) {
      logger.error("Failed to accept inspection", {
        companyId,
        inspectionId: id,
        error: result.error
      });
      throw redirect(
        back,
        await flash(request, error(result.error, "Failed to accept inspection"))
      );
    }
    throw redirect(
      origin ?? path.to.inspections,
      await flash(request, success("Inspection accepted"))
    );
  }

  // The posting refuses a decided lot too; reading it first tells the
  // inspector so instead of reporting a failed write-off.
  const before = await getCarbonServiceRole()
    .from("inspection")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (before.data && isInspectionClosed(before.data.status)) {
    throw redirect(
      back,
      await flash(request, error(null, "This inspection was already decided"))
    );
  }

  const rejected = await erpPosting(
    "reject-inspection",
    { companyId, userId, client },
    // One-shot, as Accept: a second Reject must not open a second NCR.
    { id, reason: reason || null, createNcr, requireOpen: true }
  );
  if (rejected.error) {
    logger.error("Failed to reject inspection", {
      companyId,
      inspectionId: id,
      error: rejected.error
    });
    // The ERP rejects the lot first, then writes stock off and opens the NCR.
    // A failure after the verdict leaves a Failed lot: say what is left.
    const lot = await getCarbonServiceRole()
      .from("inspection")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    const message =
      lot.data?.status === "Failed"
        ? "Inspection rejected, but its write-off or NCR failed. Finish it from the inspection in the ERP."
        : rejected.error.message || "Failed to reject inspection";
    throw redirect(back, await flash(request, error(rejected.error, message)));
  }

  throw redirect(
    origin ?? path.to.inspections,
    await flash(
      request,
      success(
        rejected.data.issueId
          ? "Inspection rejected and NCR opened"
          : "Inspection rejected"
      )
    )
  );
}
