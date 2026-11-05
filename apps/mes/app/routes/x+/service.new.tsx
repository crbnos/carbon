// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { userContext } from "~/context";
import { serviceJobNewValidator } from "~/services/models";
import {
  CLOCK_ALREADY_RUNNING,
  getRunningServiceClock,
  getServiceLaborRates,
  insertServiceJob,
  isRunningClockConflict,
  SERVICE_LABOR_COST_RATE_MISSING,
  startServiceClock
} from "~/services/service.service";
import { path } from "~/utils/path";

const log = getLogger("mes", "service-job");

/**
 * MES → Service → New Job: a job on a unit (or only a customer), In
 * Progress, assigned to the technician, with their clock started on it.
 */
export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const locationId = context.get(userContext)?.locationId;

  const formData = await request.formData();
  const validation = await validator(serviceJobNewValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }
  const input = validation.data;

  if (!locationId) {
    return data(
      {},
      await flash(request, error(null, "Choose your location first"))
    );
  }

  const serviceRole = await getCarbonServiceRole();

  // The writes below are service-role, so every id from the form must be this
  // company's: the customer, and the asset (which must be that customer's).
  const [customer, asset, rates, running] = await Promise.all([
    serviceRole
      .from("customer")
      .select("id")
      .eq("id", input.customerId)
      .eq("companyId", companyId)
      .maybeSingle(),
    input.customerAssetId
      ? serviceRole
          .from("customerAsset")
          .select("id, customerId, itemId, trackedEntityId")
          .eq("id", input.customerAssetId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    getServiceLaborRates(serviceRole, companyId),
    getRunningServiceClock(serviceRole, { employeeId: userId, companyId })
  ]);
  if (
    !customer.data ||
    (asset && (!asset.data || asset.data.customerId !== input.customerId))
  ) {
    log.warn("Service job references records outside the company", {
      companyId,
      customerId: input.customerId,
      customerAssetId: input.customerAssetId,
      error: customer.error ?? asset?.error
    });
    return data(
      {},
      await flash(request, error(null, "Customer or asset not found"))
    );
  }
  if (rates.error) {
    return data(
      {},
      await flash(
        request,
        error(rates.error, "Failed to load the company settings")
      )
    );
  }
  // The job starts a clock, whose cost posts at the company's cost rate.
  if (rates.data.costRate === null) {
    return data(
      {},
      await flash(request, error(null, SERVICE_LABOR_COST_RATE_MISSING))
    );
  }
  if (running.data) {
    return data(
      {},
      await flash(
        request,
        error(
          null,
          `Your clock is running on ${
            running.data.serviceJob?.serviceJobId ?? "another job"
          }. Stop it first.`
        )
      )
    );
  }

  const job = await insertServiceJob(serviceRole, {
    customerId: input.customerId,
    customerAssetId: asset?.data?.id ?? null,
    itemId: asset?.data?.itemId ?? null,
    trackedEntityId: asset?.data?.trackedEntityId ?? null,
    locationId,
    workSite: input.workSite,
    coverage: input.coverage,
    problem: input.problem,
    assignee: userId,
    laborBillRate: rates.data.billRate,
    companyId,
    createdBy: userId
  });
  if (job.error || !job.data) {
    return data(
      {},
      await flash(request, error(job.error, "Failed to create the service job"))
    );
  }

  const clock = await startServiceClock(serviceRole, {
    serviceJobId: job.data.id,
    employeeId: userId,
    billable: input.coverage === "Billable",
    companyId,
    createdBy: userId
  });
  if (clock.error) {
    log.error("Failed to start the clock on a new service job", {
      companyId,
      serviceJobId: job.data.id,
      error: clock.error
    });
    throw redirect(
      path.to.serviceJob(job.data.id),
      await flash(
        request,
        error(
          clock.error,
          isRunningClockConflict(clock.error)
            ? CLOCK_ALREADY_RUNNING
            : `${job.data.serviceJobId} created, but the clock did not start`
        )
      )
    );
  }

  throw redirect(
    path.to.serviceJob(job.data.id),
    await flash(request, success(`${job.data.serviceJobId} created`))
  );
}
