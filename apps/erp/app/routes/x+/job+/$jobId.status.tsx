import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { runLocationSchedule } from "@carbon/ee/planning";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getJobReleaseReadiness,
  jobStatus,
  recalculateJobRequirements,
  runMRP,
  updateJobStatus
} from "~/modules/production";
import { releaseJobs } from "~/modules/production/production.server";
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

  if (!status || !jobStatus.includes(status)) {
    throw redirect(
      path.to.job(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  if (status === "Ready") {
    const { data } = await client
      .from("job")
      .select("item(itemReplenishment(manufacturingBlocked))")
      .eq("id", id)
      .single();

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
    const missing = readiness.data?.jobs[0]?.missingAssemblies ?? [];
    if (readiness.error || missing.length > 0) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(
          request,
          error(
            readiness.error,
            readiness.error
              ? "Failed to validate job"
              : `Assign an operation to each assembly before releasing: ${missing
                  .map((m) => m.description)
                  .join(", ")}`
          )
        )
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

  if (status === "Planned" && shouldSchedule) {
    try {
      const purchaseOrdersBySupplierId = JSON.parse(
        selectedPurchaseOrdersBySupplierId ?? "{}"
      );
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
