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
import {
  getLease,
  leaseDurationOf,
  leaseValidator,
  resolveLeaseDates
} from "~/modules/purchasing";
import { updateDraftLease } from "~/modules/purchasing/purchasing.server";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import { LeaseDetailsForm } from "~/modules/purchasing/ui/Leases";
import { getDatabaseClient } from "~/services/database.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

const logger = getLogger("erp", "lease-setup-details");

/** Saves a Draft's details from setup step 1 and moves on to Assets. New
 *  dates move every asset's payment rows: `updateDraftLease` cuts them again
 *  in the same transaction. */
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
  // Invoicing that started at the old commencement follows a new one, as a
  // single saved term does (update.tsx).
  const commencementDate = formData.get("commencementDate");
  const invoiceFromDate = formData.get("invoiceFromDate");
  if (
    typeof commencementDate === "string" &&
    commencementDate &&
    current.data.commencementDate &&
    current.data.invoiceFromDate
  ) {
    formData.set(
      "invoiceFromDate",
      resolveLeaseDates(
        {
          commencementDate: current.data.commencementDate,
          invoiceFromDate: current.data.invoiceFromDate
        },
        {
          commencementDate,
          invoiceFromDate:
            typeof invoiceFromDate === "string" ? invoiceFromDate : null
        }
      ).invoiceFromDate
    );
  }

  const validation = await validator(leaseValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, leaseId: _leaseId, ...data } = validation.data;

  try {
    // Refuses a lease that is no longer a Draft.
    await updateDraftLease(getDatabaseClient(), {
      leaseId: id,
      companyId,
      userId,
      terms: data,
      // Merged, so a field the form did not render is kept.
      customFields: {
        ...((current.data.customFields ?? {}) as Record<string, unknown>),
        ...setCustomFields(formData)
      } as Json
    });
  } catch (err) {
    logger.error("lease details were not saved", {
      companyId,
      leaseId: id,
      error: err
    });
    throw redirect(
      path.to.leaseSetup(id, "details"),
      await flash(
        request,
        error(err, getErrorMessage(err, "Failed to update lease"))
      )
    );
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
        name: lease.name ?? undefined,
        description: lease.description ?? undefined,
        supplierId: lease.supplierId ?? "",
        supplierLocationId: lease.supplierLocationId ?? undefined,
        supplierContactId: lease.supplierContactId ?? undefined,
        locationId: lease.locationId ?? undefined,
        assignee: lease.assignee ?? undefined,
        commencementDate: lease.commencementDate ?? "",
        duration: leaseDurationOf(lease),
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
