// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { isServiceJobLocked, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  CLOCK_ALREADY_RUNNING,
  completeServiceJob,
  getDefaultLaborItemId,
  getRunningServiceClock,
  isRunningClockConflict,
  startServiceClock,
  stopServiceClock,
  updateServiceJobStatus
} from "~/services/service.service";
import { path } from "~/utils/path";

const logger = getLogger("mes", "service-time");

/**
 * The technician's clock on a service job, and its completion. Start writes a
 * time entry with a start time; Stop sets its end, hours and day; Complete
 * stops the clock and completes the job in the ERP (`post-service-job`).
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const action = formData.get("action") as "Start" | "Stop" | "Complete";
  const serviceJobId = formData.get("serviceJobId") as string;

  if (!serviceJobId) {
    return data({}, await flash(request, error("Service job is required")));
  }

  const serviceRole = await getCarbonServiceRole();

  // Every write below is service-role and the id comes from the form, so the
  // job must be this company's.
  const job = await serviceRole
    .from("serviceJob")
    .select("id, serviceJobId, status, coverage, signedByName, signaturePath")
    .eq("id", serviceJobId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!job.data) {
    logger.warn("Service job not found in company", {
      companyId,
      serviceJobId,
      error: job.error
    });
    return data({}, await flash(request, error(null, "Service job not found")));
  }

  if (action === "Start") {
    if (isServiceJobLocked(job.data.status)) {
      return data(
        {},
        await flash(request, error(null, `This job is ${job.data.status}`))
      );
    }

    // A stale page or a double tap can submit Start while a clock runs.
    const running = await getRunningServiceClock(serviceRole, {
      employeeId: userId,
      companyId
    });
    if (running.data) {
      return running.data.serviceJobId === serviceJobId
        ? data({}, await flash(request, success("Clock started")))
        : data(
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

    const laborItemId = await getDefaultLaborItemId(serviceRole, companyId);
    if (!laborItemId.data) {
      return data(
        {},
        await flash(
          request,
          error(
            laborItemId.error,
            "Set the default labor item in the ERP's invoicing settings before you start a clock"
          )
        )
      );
    }

    const started = await startServiceClock(serviceRole, {
      serviceJobId,
      employeeId: userId,
      laborItemId: laborItemId.data,
      billable: job.data.coverage === "Billable",
      companyId,
      createdBy: userId
    });
    if (started.error) {
      return data(
        {},
        await flash(
          request,
          error(
            started.error,
            isRunningClockConflict(started.error)
              ? CLOCK_ALREADY_RUNNING
              : "Failed to start the clock"
          )
        )
      );
    }

    if (job.data.status === "Open") {
      const status = await updateServiceJobStatus(serviceRole, {
        serviceJobId,
        status: "In Progress",
        companyId,
        updatedBy: userId
      });
      if (status.error) {
        logger.error("Failed to set the service job In Progress", {
          companyId,
          serviceJobId,
          error: status.error
        });
      }
    }

    return data({}, await flash(request, success("Clock started")));
  }

  if (action === "Stop") {
    const stopped = await stopServiceClock(serviceRole, {
      employeeId: userId,
      companyId,
      updatedBy: userId
    });
    if (stopped.error) {
      return data(
        {},
        await flash(request, error(stopped.error, "Failed to stop the clock"))
      );
    }
    if (!stopped.data) {
      return data(
        {},
        await flash(request, error(null, "Your clock is not running"))
      );
    }
    return data({}, await flash(request, success("Clock stopped")));
  }

  if (action === "Complete") {
    // Stop the technician's clock when it runs on this job: the ERP refuses
    // to complete a job with a running clock.
    const running = await getRunningServiceClock(serviceRole, {
      employeeId: userId,
      companyId
    });
    if (running.data?.serviceJobId === serviceJobId) {
      const stopped = await stopServiceClock(serviceRole, {
        employeeId: userId,
        companyId,
        updatedBy: userId
      });
      if (stopped.error) {
        return data(
          {},
          await flash(request, error(stopped.error, "Failed to stop the clock"))
        );
      }
    }

    const completed = await completeServiceJob(serviceRole, {
      serviceJobId,
      signedByName: job.data.signedByName ?? undefined,
      signaturePath: job.data.signaturePath ?? undefined,
      companyId,
      userId
    });
    if (completed.error) {
      logger.error("Failed to complete the service job", {
        companyId,
        serviceJobId,
        error: completed.error
      });
      return data(
        {},
        await flash(request, error(completed.error, completed.error.message))
      );
    }

    throw redirect(
      path.to.service,
      await flash(request, success(`${job.data.serviceJobId} completed`))
    );
  }

  return data({});
}
