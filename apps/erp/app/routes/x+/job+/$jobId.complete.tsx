import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { jobCompleteValidator } from "~/modules/production";
import type { Handle } from "~/utils/handle";
import { path, requestReferrer } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.jobs,
  module: "production"
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const validation = await validator(jobCompleteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const { quantityComplete, locationId, storageUnitId } = validation.data;

  // Complete the job to inventory: sets job.quantityComplete and receives the
  // finished goods. It must NOT write job.quantityShipped — that column tracks
  // units actually shipped and is advanced only by post-shipment. The shipment
  // builder computes quantityToShip = quantityComplete - quantityShipped, so
  // pre-setting quantityShipped here zeroes out the shippable quantity and the
  // sales order can no longer be shipped (empty shipment lines).
  const rpc = await client.rpc("complete_job_to_inventory", {
    p_job_id: jobId,
    p_quantity_complete: quantityComplete,
    p_storage_unit_id: storageUnitId ?? undefined,
    p_location_id: locationId ?? undefined,
    p_company_id: companyId,
    p_user_id: userId
  });

  if (rpc.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(jobId),
      await flash(request, error(rpc.error, "Failed to complete job"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(jobId),
    await flash(request, success("Job completed successfully"))
  );
}
