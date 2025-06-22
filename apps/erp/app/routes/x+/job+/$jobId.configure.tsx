import { error, getCarbonServiceRole, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { tasks } from "@trigger.dev/sdk/v3";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { upsertJobMethod } from "~/modules/production";
import type { recalculateTask } from "~/trigger/recalculate";
import { path, requestReferrer } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
    role: "employee",
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
          updatedBy: userId,
        })
        .eq("id", jobId),
      client.from("job").select("itemId").eq("id", jobId).single(),
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

    const serviceRole = await getCarbonServiceRole();
    const upsertMethod = await upsertJobMethod(serviceRole, "itemToJob", {
      sourceId: job.data.itemId,
      targetId: jobId,
      companyId,
      userId,
      configuration,
    });

    if (upsertMethod.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, error("Failed to update job method"))
      );
    }

    await tasks.trigger<typeof recalculateTask>("recalculate", {
      type: "jobRequirements",
      id: jobId,
      companyId,
      userId,
    });
  } else {
    throw new Error("No configuration provided");
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(jobId),
    await flash(request, success("Updated job"))
  );
}
