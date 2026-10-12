// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { getLease, leaseValidator, updateLease } from "~/modules/purchasing";
import { regenerateLeasePayments } from "~/modules/purchasing/purchasing.server";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import { LeaseDetailsForm } from "~/modules/purchasing/ui/Leases";
import { getDatabaseClient } from "~/services/database.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

const logger = getLogger("erp", "lease-setup-details");

/** The dates the payment rows are cut from: a change cuts them again. */
const PAYMENT_DATES = [
  "commencementDate",
  "endDate",
  "invoiceFromDate"
] as const;

/** Saves a Draft's details from setup step 1 and moves on to Assets. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const current = await getLease(client, id, companyId);
  if (current.error || current.data?.companyId !== companyId) {
    throw redirect(
      path.to.leases,
      await flash(request, error(current.error, "Lease not found"))
    );
  }

  const formData = await request.formData();
  const validation = await validator(leaseValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, leaseId: _leaseId, ...data } = validation.data;

  // Refuses a lease that is no longer a Draft.
  const update = await updateLease(client, {
    ...data,
    id,
    companyId,
    updatedBy: userId,
    // Merged, so a field the form did not render is kept.
    customFields: {
      ...((current.data.customFields ?? {}) as Record<string, unknown>),
      ...setCustomFields(formData)
    } as Json
  });
  if (update.error) {
    throw redirect(
      path.to.leaseSetup(id, "details"),
      await flash(
        request,
        error(update.error, update.error.message || "Failed to update lease")
      )
    );
  }

  // New dates move every payment row of every asset: cut them again. A
  // lease with no asset yet has none to cut.
  const datesChanged = PAYMENT_DATES.some(
    (field) => (current.data[field] ?? "") !== (data[field] ?? "")
  );
  if (datesChanged && Number(current.data.assetCount ?? 0) > 0) {
    try {
      await regenerateLeasePayments(getDatabaseClient(), {
        leaseId: id,
        companyId,
        userId
      });
    } catch (err) {
      logger.error("lease payment rows were not cut again", {
        companyId,
        leaseId: id,
        error: err
      });
      throw redirect(
        path.to.leaseSetup(id, "payments"),
        await flash(
          request,
          error(
            err,
            getErrorMessage(
              err,
              "The details were saved, but the payment rows could not be cut again"
            )
          )
        )
      );
    }
  }

  throw redirect(path.to.leaseSetup(id, "assets"));
}

export default function LeaseSetupDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;
  const { lease } = routeData;

  return (
    <LeaseDetailsForm
      key={lease.updatedAt ?? id}
      action={path.to.leaseSetup(id, "details")}
      initialValues={{
        id,
        leaseId: lease.leaseId ?? undefined,
        name: lease.name ?? "",
        description: lease.description ?? undefined,
        supplierId: lease.supplierId ?? "",
        supplierLocationId: lease.supplierLocationId ?? undefined,
        supplierContactId: lease.supplierContactId ?? undefined,
        locationId: lease.locationId ?? undefined,
        assignee: lease.assignee ?? undefined,
        commencementDate: lease.commencementDate ?? "",
        endDate: lease.endDate ?? "",
        noticeDate: lease.noticeDate ?? undefined,
        invoiceFromDate: lease.invoiceFromDate ?? undefined,
        paymentFrequency: lease.paymentFrequency ?? "Monthly",
        paymentTiming: lease.paymentTiming ?? "Advance",
        annualEscalationPercent: Number(lease.annualEscalationPercent ?? 0),
        discountRate: Number(lease.discountRate ?? 0),
        currencyCode: lease.currencyCode ?? "",
        ...getCustomFields(lease.customFields)
      }}
    />
  );
}
