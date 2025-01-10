import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { jobCompleteValidator } from "~/modules/production";
import type { Handle } from "~/utils/handle";
import { path, requestReferrer } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
  module: "production",
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const formData = await request.formData();
  const validation = await validator(jobCompleteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const {
    quantityComplete,
    salesOrderId,
    salesOrderLineId,
    locationId,
    shelfId,
  } = validation.data;

  const makeToOrder = !!salesOrderId || !!salesOrderLineId;

  if (makeToOrder) {
    const makeToOrderUpdate = await client
      .from("job")
      .update({
        status: "Completed" as const,
        completedDate: new Date().toISOString(),
        quantityComplete,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      })
      .eq("id", jobId);

    if (makeToOrderUpdate.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(
          request,
          error(makeToOrderUpdate.error, "Failed to complete job")
        )
      );
    }
  } else {
    const serviceRole = await getCarbonServiceRole();
    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        jobId,
        type: "jobComplete",
        companyId,
        userId,
        quantityComplete,
        shelfId,
        locationId,
      },
    });

    if (issue.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, error(issue.error, "Failed to complete job"))
      );
    }
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(jobId),
    await flash(request, success("Job completed successfully"))
  );
}
