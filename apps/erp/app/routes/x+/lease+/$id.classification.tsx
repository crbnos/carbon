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
import { leaseClassificationValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

const logger = getLogger("erp", "lease-classification");

/**
 * Overrides a lease's lessee classification (spec §2). An accounting
 * decision, so it is gated on `update: accounting` rather than the
 * purchasing permissions the rest of the lease uses; the read and the write
 * go through the service role, scoped to the company and the lease in the
 * URL, because an accountant need not hold `purchasing_update` for the
 * lease's RLS. Only a Draft lease can change — activation keeps an
 * overridden value and posts the commencement journal from it.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const validation = await validator(leaseClassificationValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { classification, reason } = validation.data;
  const serviceRole = getCarbonServiceRole();

  const lease = await serviceRole
    .from("lease")
    .select("id, status, classificationOverride, classificationOverrideReason")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();

  if (lease.error || !lease.data) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Lease not found"))
    );
  }

  if (lease.data.status !== "Draft") {
    throw redirect(
      path.to.leaseDetails(id),
      await flash(
        request,
        error(null, "The classification is fixed once the lease is activated")
      )
    );
  }

  // Activation stamps `lesseeClassification`, so an unstamped lease is one
  // still to be classified. The filter closes the gap between the status
  // read above and this write: a lease activated in between matches no row,
  // and its commenced treatment is never overwritten.
  const update = await serviceRole
    .from("lease")
    .update({
      classificationOverride: classification,
      classificationOverrideReason: reason,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .is("lesseeClassification", null)
    .select("id")
    .maybeSingle();

  if (update.error) {
    logger.error("lease classification override failed", {
      companyId,
      leaseId: id,
      error: update.error
    });
    throw redirect(
      path.to.leaseDetails(id),
      await flash(
        request,
        error(update.error, "Failed to override the classification")
      )
    );
  }

  if (!update.data) {
    throw redirect(
      path.to.leaseDetails(id),
      await flash(
        request,
        error(null, "The classification is fixed once the lease is activated")
      )
    );
  }

  // Best-effort — the audit write creates the company's audit table on first
  // use, whether or not the audit log is switched on; a failure never undoes
  // the override, and the lease keeps the override and its reason
  // regardless.
  try {
    await insertAuditLogEntries(serviceRole, companyId, [
      {
        tableName: "lease",
        entityType: "lease",
        entityId: id,
        recordId: id,
        operation: "UPDATE",
        actorId: userId,
        diff: {
          classificationOverride: {
            old: lease.data.classificationOverride,
            new: classification
          },
          classificationOverrideReason: {
            old: lease.data.classificationOverrideReason,
            new: reason
          }
        },
        metadata: { origin: "web" }
      }
    ]);
  } catch (err) {
    logger.warn("audit write skipped for a lease classification override", {
      error: err
    });
  }

  throw redirect(
    path.to.leaseDetails(id),
    await flash(request, success(`Classified as ${classification}`))
  );
}
