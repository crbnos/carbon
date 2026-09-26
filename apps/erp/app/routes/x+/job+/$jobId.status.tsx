import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { cancelOpenPickingListsForJob } from "~/modules/inventory";
import {
  getJobReleaseReadiness,
  jobStatus,
  recalculateJobRequirements,
  returnPickedRemaindersForJob,
  runMRP,
  updateJobStatus
} from "~/modules/production";
import { releaseJobs } from "~/modules/production/production.server";
import { afterJobsReleased } from "~/modules/quality/firstArticle.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "jobid-status");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find id");

  const url = new URL(request.url);
  const shouldSchedule = url.searchParams.get("schedule") === "1";

  const formData = await request.formData();
  const status = formData.get("status") as (typeof jobStatus)[number];
  const selectedPurchaseOrdersBySupplierId = formData.get(
    "selectedPurchaseOrdersBySupplierId"
  ) as string | null;
  const selectedSupplierProcessByOperationId = formData.get(
    "selectedSupplierProcessByOperationId"
  ) as string | null;

  if (!status || !jobStatus.includes(status)) {
    throw redirect(
      path.to.job(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // Ready from Draft/Planned is a release; from Paused it is a resume, which
  // neither re-checks release readiness nor creates first articles.
  let isRelease = false;
  if (status === "Ready") {
    const { data } = await client
      .from("job")
      .select("status, item(itemReplenishment(manufacturingBlocked))")
      .eq("id", id)
      .single();
    isRelease = data?.status === "Draft" || data?.status === "Planned";

    if (data?.item?.itemReplenishment?.manufacturingBlocked) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(null, "Manufacturing is blocked"))
      );
    }
  }

  // The Release dialog: the shared release path (also run by batch release),
  // re-checking what the dialog checked, then one schedule run for the location.
  if (status === "Ready" && shouldSchedule) {
    const readiness = await getJobReleaseReadiness(client, [id], companyId);
    const job = readiness.data?.jobs[0];
    const missing = job?.missingAssemblies ?? [];
    const withoutPlan = job?.firstArticlesWithoutPlan ?? [];
    if (readiness.error || missing.length > 0 || withoutPlan.length > 0) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(
          request,
          error(
            readiness.error,
            readiness.error
              ? "Failed to validate job"
              : missing.length > 0
                ? `Assign an operation to each assembly before releasing: ${missing
                    .map((m) => m.description)
                    .join(", ")}`
                : firstArticlePlanRefusal(withoutPlan)
          )
        )
      );
    }

    try {
      await stampSupplierChoices({
        jobId: id,
        companyId,
        userId,
        choices: JSON.parse(selectedSupplierProcessByOperationId ?? "{}")
      });
    } catch (err) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(err, "Failed to save the supplier choice"))
      );
    }

    const released = await releaseJobs({
      client,
      db: getDatabaseClient(),
      jobIds: [id],
      companyId,
      userId,
      purchaseOrdersBySupplierId: JSON.parse(
        selectedPurchaseOrdersBySupplierId ?? "{}"
      )
    });
    if (released.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(null, released.error))
      );
    }

    try {
      await scheduleJobLocation({ id, companyId, userId });
    } catch (err) {
      logger.error("Error", { error: err });
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(err, "Failed to schedule job"))
      );
    }

    throw redirect(
      requestReferrer(request) ?? path.to.job(id),
      await flash(request, success("Updated job status"))
    );
  }

  // A plain Ready post (no Release dialog) that releases the job: a part that
  // needs a first article but has no plan to inspect against refuses it here
  // too, so no release path skips the blocker.
  if (isRelease) {
    const readiness = await getJobReleaseReadiness(client, [id], companyId);
    const withoutPlan = readiness.data?.jobs[0]?.firstArticlesWithoutPlan ?? [];
    if (readiness.error || withoutPlan.length > 0) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(
          request,
          error(
            readiness.error,
            readiness.error
              ? "Failed to validate job"
              : firstArticlePlanRefusal(withoutPlan)
          )
        )
      );
    }
  }

  if (["Planned", "Ready"].includes(status)) {
    const serviceRole = getCarbonServiceRole();
    await recalculateJobRequirements(serviceRole, {
      id,
      companyId,
      userId
    });
    await runMRP(getCarbonServiceRole(), getDatabaseClient(), {
      type: "job",
      id,
      companyId,
      userId
    });
  }

  // Commit the new status BEFORE invoking the scheduler. The `schedule` edge
  // function only batches jobs whose status is already Ready/In Progress/Paused,
  // so a job released here must be persisted as Ready first — otherwise it is
  // filtered out of its own scheduling run and never lands in the forecast.
  //
  // A direct POST of status=Completed here bypasses complete_job_to_inventory
  // (no inventory receipt, no backflush) and therefore also skips the
  // picked-material return sweep. The UI never sends Completed to this route —
  // the Complete button uses $jobId.complete.tsx, which runs both.
  if (status === "Cancelled") {
    const sweep = await returnPickedRemaindersForJob(getCarbonServiceRole(), {
      jobId: id,
      userId,
      companyId
    });
    if (sweep.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(
          request,
          error(sweep.error, "Cancel aborted: returning picked material failed")
        )
      );
    }
    const picks = await cancelOpenPickingListsForJob(getDatabaseClient(), {
      jobId: id,
      companyId,
      userId
    });
    if (picks.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(
          request,
          error(
            picks.error,
            "Cancel aborted: its picking lists could not be closed"
          )
        )
      );
    }
  }

  const update = await updateJobStatus(client, {
    id,
    companyId,
    status,
    assignee: ["Cancelled"].includes(status) ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(id),
      await flash(request, error(update.error, "Failed to update job status"))
    );
  }

  if (isRelease) {
    await afterJobsReleased(getDatabaseClient(), client, {
      jobIds: [id],
      companyId,
      userId
    });
  }

  if (status === "Planned" && shouldSchedule) {
    try {
      const purchaseOrdersBySupplierId = JSON.parse(
        selectedPurchaseOrdersBySupplierId ?? "{}"
      );
      await stampSupplierChoices({
        jobId: id,
        companyId,
        userId,
        choices: JSON.parse(selectedSupplierProcessByOperationId ?? "{}")
      });
      // Regenerate the whole location in parallel with PO creation.
      await Promise.all([
        scheduleJobLocation({ id, companyId, userId }),
        getCarbonServiceRole().functions.invoke("create", {
          body: {
            type: "purchaseOrderFromJob",
            jobId: id,
            purchaseOrdersBySupplierId,
            companyId,
            userId
          }
        })
      ]);
    } catch (err) {
      logger.error("Error", { error: err });
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(err, "Failed to schedule job"))
      );
    }
  }

  if (status === "Closed") {
    const serviceRole = await getCarbonServiceRole();
    await serviceRole.functions.invoke("close-job", {
      body: { jobId: id, userId, companyId }
    });
  }

  if (status === "Planned") {
    throw redirect(
      path.to.jobMaterials(id),
      await flash(request, success("Job marked as planned"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(id),
    await flash(request, success("Updated job status"))
  );
}

function firstArticlePlanRefusal(parts: { description: string }[]) {
  return `Assign a first article plan for ${parts
    .map((part) => part.description)
    .join(", ")}`;
}

// Forecast-first scheduling regenerates the whole location the job is in,
// in-process (Node) — no edge cold-start or HTTP hop. Throws on failure.
async function scheduleJobLocation({
  id,
  companyId,
  userId
}: {
  id: string;
  companyId: string;
  userId: string;
}) {
  const serviceRole = getCarbonServiceRole();
  const { data: jobLocation } = await serviceRole
    .from("job")
    .select("locationId")
    .eq("id", id)
    .single();
  if (!jobLocation?.locationId) {
    throw new Error("Job has no location to schedule");
  }
  await runLocationSchedule({
    db: getDatabaseClient(),
    client: serviceRole,
    locationId: jobLocation.locationId,
    companyId,
    userId
  });
}

// The release dialog's supplier pick for an outside operation whose process has
// several suppliers, stamped on the operation so purchaseOrderFromJob resolves
// it. Must land BEFORE the purchase orders are created.
async function stampSupplierChoices({
  jobId,
  companyId,
  userId,
  choices
}: {
  jobId: string;
  companyId: string;
  userId: string;
  choices: Record<string, string>;
}) {
  const serviceRole = getCarbonServiceRole();
  const operationSupplierChoices = Object.entries(choices);
  if (operationSupplierChoices.length > 0) {
    // Both ids come from the form and drive a service-role (RLS-bypassing)
    // write that purchaseOrderFromJob later consumes, so validate them before
    // persisting: the operation must belong to THIS job, and the chosen
    // supplier process must belong to that operation's own process. Otherwise
    // a crafted submit could retarget another job or create a PO for an
    // unrelated supplier.
    const operationIds = operationSupplierChoices.map(
      ([operationId]) => operationId
    );
    const supplierProcessIds = operationSupplierChoices.map(([, sp]) => sp);

    const [
      { data: jobOperations, error: jobOperationsError },
      { data: supplierProcesses, error: supplierProcessesError }
    ] = await Promise.all([
      serviceRole
        .from("jobOperation")
        .select("id, processId")
        .eq("jobId", jobId)
        .eq("companyId", companyId)
        .in("id", operationIds),
      serviceRole
        .from("supplierProcess")
        .select("id, processId")
        .eq("companyId", companyId)
        .in("id", supplierProcessIds)
    ]);
    if (jobOperationsError) throw new Error(jobOperationsError.message);
    if (supplierProcessesError) throw new Error(supplierProcessesError.message);

    const operationProcessById = new Map(
      (jobOperations ?? []).map((op) => [op.id, op.processId])
    );
    const supplierProcessProcessById = new Map(
      (supplierProcesses ?? []).map((sp) => [sp.id, sp.processId])
    );

    for (const [operationId, supplierProcessId] of operationSupplierChoices) {
      const operationProcessId = operationProcessById.get(operationId);
      if (!operationProcessId) {
        throw new Error(`Operation ${operationId} does not belong to this job`);
      }
      if (
        supplierProcessProcessById.get(supplierProcessId) !== operationProcessId
      ) {
        throw new Error(
          "Selected supplier does not belong to the operation's process"
        );
      }
    }

    const updateResults = await Promise.all(
      operationSupplierChoices.map(([operationId, supplierProcessId]) =>
        serviceRole
          .from("jobOperation")
          .update({
            operationSupplierProcessId: supplierProcessId,
            updatedBy: userId
          })
          .eq("id", operationId)
          .eq("companyId", companyId)
      )
    );
    const failedUpdate = updateResults.find((result) => result.error);
    if (failedUpdate?.error) throw new Error(failedUpdate.error.message);
  }
}
