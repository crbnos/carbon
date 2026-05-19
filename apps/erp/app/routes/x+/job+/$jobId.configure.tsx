import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { upsertJobMethod } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
    role: "employee"
  });
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const configuration = await request.json();

  if (configuration) {
    const [result, job] = await Promise.all([
      client
        .from("job")
        .update({
          configuration,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .eq("id", jobId),
      client.from("job").select("itemId").eq("id", jobId).single()
    ]);

    if (result.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, error("Failed to update job"))
      );
    }

    if (job.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, error("Failed to get job"))
      );
    }

    const upsertMethod = await upsertJobMethod("itemToJob", {
      sourceId: job.data.itemId,
      targetId: jobId,
      configuration
    });

    if (upsertMethod.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, error("Failed to update job method"))
      );
    }

    await trigger("recalculate", {
      type: "jobRequirements",
      id: jobId,
      companyId,
      userId
    });
  } else {
    throw new Error("No configuration provided");
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(jobId),
    await flash(request, success("Updated job"))
  );
}
