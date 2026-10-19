// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SetupFrame } from "~/components/Setup";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import { leaseValidator } from "~/modules/purchasing/purchasing.models";
import { insertLease } from "~/modules/purchasing/purchasing.service";
import {
  LeaseDetailsForm,
  LeaseSetupSteps
} from "~/modules/purchasing/ui/Leases";
import {
  getCompanySettings,
  getNextSequence
} from "~/modules/settings/settings.service";
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
  // Without the settings the lease would be discounted at 0 % unnoticed.
  if (companySettings.error) {
    logger.error("company settings read failed for a new lease", {
      companyId,
      error: companySettings.error
    });
    throw redirect(
      path.to.leases,
      await flash(
        request,
        error(companySettings.error, "Failed to load the lease settings")
      )
    );
  }

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
    logger.error("lease sequence read failed", {
      companyId,
      error: sequence.error
    });
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
    logger.error("lease insert failed", { companyId, error: lease.error });
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Failed to create lease"))
    );
  }

  // The assets, and the payment rows cut for each, are the next step.
  throw redirect(path.to.leaseSetup(lease.data.id, "assets"));
}

/** Step 1 of the lease setup: creating the Draft. Every later step edits the
 *  Draft this saves (`$id.setup.*`). */
export default function NewLeaseRoute() {
  const { defaultDiscountRate } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const { company, defaults, id: userId } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    leaseId: undefined,
    name: undefined,
    supplierId: params.get("supplierId") ?? "",
    locationId: defaults?.locationId ?? "",
    // The person entering the lease usually owns it.
    assignee: userId,
    commencementDate: companyToday,
    duration: "36" as const,
    endDate: "",
    paymentFrequency: "Monthly" as const,
    paymentTiming: "Advance" as const,
    annualEscalationPercent: 0,
    discountRate: Number(defaultDiscountRate),
    // Leases are measured in the company's base currency in v1.
    currencyCode: company?.baseCurrencyCode ?? "USD"
  };

  return (
    <SetupFrame
      title={<Trans>New Lease</Trans>}
      step="details"
      steps={<LeaseSetupSteps current="details" />}
    >
      <LeaseDetailsForm
        initialValues={initialValues}
        action={path.to.newLease}
      />
    </SetupFrame>
  );
}
