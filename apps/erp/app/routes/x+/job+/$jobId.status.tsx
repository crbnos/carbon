// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  jobStatus,
  makeToAssetItemError,
  recalculateJobRequirements,
  runMRP,
  updateJobStatus
} from "~/modules/production";
import { cancelJob } from "~/modules/production/production.server";
import { serviceContext } from "~/modules/service-context.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "jobid-status");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const auth = await requirePermissions(request, {
    update: "production"
  });
  const { client, companyId, userId } = auth;
  const ctx = serviceContext(auth);

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find id");

  // Much of what follows (MRP, scheduling, picking sweeps, PO creation) runs
  // with the service role or Kysely and keys on the URL job id.
  await requireCompanyRecord(getCarbonServiceRole(), "job", companyId, { id });

  const formData = await request.formData();
  const status = formData.get("status") as (typeof jobStatus)[number];

  if (!status || !jobStatus.includes(status)) {
    throw redirect(
      path.to.job(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  if (status === "Ready") {
    const { data } = await client
      .from("job")
      .select(
        "quantity, salesOrderLineId, fixedAssetClassId, fixedAssetId, item(itemTrackingType, itemReplenishment(manufacturingBlocked))"
      )
      .eq("id", id)
      .single();

    if (data?.item?.itemReplenishment?.manufacturingBlocked) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(null, "Manufacturing is blocked"))
      );
    }

    // Make to Asset gate for a plain post to Ready (Resume). A release runs
    // the same rule in `releaseJobs` (`makeToAssetReleaseError`). The item
    // rule is `makeToAssetItemError`; a job on a sales order line is a sale,
    // not a capitalisation.
    if (data?.fixedAssetClassId || data?.fixedAssetId) {
      const itemError = makeToAssetItemError({
        fixedAssetClassId: data.fixedAssetClassId,
        fixedAssetId: data.fixedAssetId,
        itemTrackingType: data.item?.itemTrackingType,
        quantity: data.quantity
      });
      if (itemError) {
        throw redirect(
          requestReferrer(request) ?? path.to.job(id),
          await flash(request, error(null, itemError))
        );
      }
      if (data.salesOrderLineId) {
        throw redirect(
          requestReferrer(request) ?? path.to.job(id),
          await flash(
            request,
            error(
              null,
              "A job linked to a sales order line cannot complete to a fixed asset"
            )
          )
        );
      }
    }
  }

  if (["Planned", "Ready"].includes(status)) {
    const serviceRole = getCarbonServiceRole();
    await recalculateJobRequirements(serviceRole, getDatabaseClient(), {
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

  // Commit the new status BEFORE invoking the scheduler. The scheduler
  // only batches jobs whose status is already Ready/In Progress/Paused,
  // so a job released here must be persisted as Ready first — otherwise it is
  // filtered out of its own scheduling run and never lands in the forecast.
  //
  // A direct POST of status=Completed here bypasses complete_job_to_inventory
  // (no inventory receipt, no backflush) and therefore also skips the
  // picked-material return sweep. The UI never sends Completed to this route —
  // the Complete button uses $jobId.complete.tsx, which runs both.
  if (status === "Cancelled") {
    // Returns picked material and closes picking lists before the status
    // changes — the same path the planning Cancel action takes.
    const cancelled = await cancelJob(ctx, { jobId: id });
    if (cancelled.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(null, cancelled.error.message))
      );
    }
  } else {
    const update = await updateJobStatus(client, {
      id,
      companyId,
      status,
      updatedBy: userId
    });
    if (update.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(id),
        await flash(request, error(update.error, "Failed to update job status"))
      );
    }
  }

  if (status === "Closed") {
    const closed = await serverFns
      .system({ db: getDatabaseClient(), companyId, userId })
      .invoke("close-job", { jobId: id });
    if (closed.error) {
      // The status change stands; only the WIP write-off failed, as before.
      logger.error("Failed to write off WIP for closed job", {
        jobId: id,
        companyId,
        error: closed.error
      });
    }
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
