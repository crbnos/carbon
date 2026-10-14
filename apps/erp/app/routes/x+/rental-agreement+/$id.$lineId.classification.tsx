// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

import { rentalAgreementLineClassificationValidator } from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "rental-agreement-classification");

/**
 * Overrides a line's lessor classification (spec §4). An accounting decision,
 * so it is gated on `update: accounting` rather than the sales permissions the
 * rest of the agreement uses; the reads and the write go through the service
 * role, scoped to the company and the agreement in the URL, because an
 * accountant need not hold `sales_update` for the line's RLS. Only a Draft
 * agreement's lines can change — activation keeps an overridden value and
 * posts the commencement journal from it.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const formData = await request.formData();
  const validation = await validator(
    rentalAgreementLineClassificationValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { classification, reason } = validation.data;
  const serviceRole = getCarbonServiceRole();

  const [agreement, line] = await Promise.all([
    serviceRole
      .from("rentalAgreement")
      .select("id, status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    serviceRole
      .from("rentalAgreementLine")
      .select(
        "id, lessorClassification, classificationOverride, classificationOverrideReason"
      )
      .eq("id", lineId)
      .eq("rentalAgreementId", id)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);

  if (agreement.error || !agreement.data || line.error || !line.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          agreement.error ?? line.error,
          "This unit does not belong to this rental agreement"
        )
      )
    );
  }

  if (agreement.data.status !== "Draft") {
    throw redirect(
      path.to.rentalAgreementLine(id, lineId),
      await flash(
        request,
        error(
          null,
          "The classification is fixed once the agreement is activated"
        )
      )
    );
  }

  // Activation stamps `classificationInputs`, so an unstamped line is one
  // still to be classified. The filter closes the gap between the status
  // read above and this write: an agreement activated in between matches no
  // row, and its commenced treatment is never overwritten.
  const update = await serviceRole
    .from("rentalAgreementLine")
    .update({
      lessorClassification: classification,
      classificationOverride: true,
      classificationOverrideReason: reason,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", lineId)
    .eq("companyId", companyId)
    .is("classificationInputs", null)
    .select("id")
    .maybeSingle();

  if (update.error) {
    logger.error("classification override failed", {
      companyId,
      lineId,
      error: update.error
    });
    throw redirect(
      path.to.rentalAgreementLine(id, lineId),
      await flash(
        request,
        error(update.error, "Failed to override the classification")
      )
    );
  }

  if (!update.data) {
    throw redirect(
      path.to.rentalAgreementLine(id, lineId),
      await flash(
        request,
        error(
          null,
          "The classification is fixed once the agreement is activated"
        )
      )
    );
  }

  // Best-effort — the audit write creates the company's audit table on first
  // use, whether or not the audit log is switched on; a failure never undoes
  // the override, and the line keeps the flag and its reason regardless.
  try {
    await insertAuditLogEntries(serviceRole, companyId, [
      {
        tableName: "rentalAgreementLine",
        entityType: "rentalAgreement",
        entityId: id,
        recordId: lineId,
        operation: "UPDATE",
        actorId: userId,
        diff: {
          lessorClassification: {
            old: line.data.lessorClassification,
            new: classification
          },
          classificationOverride: {
            old: line.data.classificationOverride,
            new: true
          },
          classificationOverrideReason: {
            old: line.data.classificationOverrideReason,
            new: reason
          }
        },
        metadata: { origin: "web" }
      }
    ]);
  } catch (err) {
    logger.warn("audit write skipped for a classification override", {
      error: err
    });
  }

  throw redirect(
    path.to.rentalAgreementLine(id, lineId),
    await flash(request, success(`Classified as ${classification}`))
  );
}
