// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import { insertLease, leaseValidator } from "~/modules/purchasing";
import { regenerateLeasePayments } from "~/modules/purchasing/purchasing.server";
import { LeaseForm } from "~/modules/purchasing/ui/Leases";
import { getCompanySettings, getNextSequence } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "lease-new");

export const handle: Handle = {
  breadcrumb: msg`Leases`,
  to: path.to.leases
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const companySettings = await getCompanySettings(client, companyId);

  return {
    // Annual %, the rate the payments are discounted at.
    defaultDiscountRate:
      companySettings.data?.leaseIncrementalBorrowingRate ?? 0
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(leaseValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, leaseId: _leaseId, ...data } = validation.data;

  const sequence = await getNextSequence(client, "lease", companyId);
  if (sequence.error || !sequence.data) {
    throw redirect(
      path.to.leases,
      await flash(
        request,
        error(sequence.error, "Failed to get the next lease number")
      )
    );
  }

  const lease = await insertLease(client, {
    ...data,
    leaseId: sequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (lease.error || !lease.data) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Failed to create lease"))
    );
  }

  // The payment rows are cut from the terms; the lease page shows them for
  // editing before activation.
  try {
    await regenerateLeasePayments(getDatabaseClient(), {
      leaseId: lease.data.id,
      companyId,
      userId
    });
  } catch (err) {
    logger.error("lease payment rows were not cut", {
      companyId,
      leaseId: lease.data.id,
      error: err
    });
    throw redirect(
      path.to.leaseDetails(lease.data.id),
      await flash(
        request,
        error(
          err,
          getErrorMessage(
            err,
            "Lease created, but its payment rows could not be cut"
          )
        )
      )
    );
  }

  throw redirect(path.to.leaseDetails(lease.data.id));
}

export default function NewLeaseRoute() {
  const { defaultDiscountRate } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const { company, defaults, id: userId } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    leaseId: undefined,
    name: "",
    supplierId: params.get("supplierId") ?? "",
    locationId: defaults?.locationId ?? "",
    // The person entering the lease usually owns it.
    assignee: userId,
    commencementDate: companyToday,
    endDate: "",
    paymentAmount: 0,
    paymentFrequency: "Monthly" as const,
    paymentTiming: "Advance" as const,
    annualEscalationPercent: 0,
    discountRate: Number(defaultDiscountRate),
    // Leases are measured in the company's base currency in v1.
    currencyCode: company?.baseCurrencyCode ?? "USD",
    ownershipTransfers: false,
    specializedAsset: false,
    purchaseOptionReasonablyCertain: false
  };

  return (
    <NewRecordPage>
      <LeaseForm initialValues={initialValues} />
    </NewRecordPage>
  );
}
