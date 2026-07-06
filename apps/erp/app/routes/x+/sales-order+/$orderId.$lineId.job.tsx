import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { insertJob, salesOrderToJobValidator } from "~/modules/production";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId, lineId } = params;
  if (!orderId || !lineId) {
    throw new Error("Invalid orderId or lineId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(salesOrderToJobValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const methodSource = d.quoteId && d.quoteLineId ? "quoteLine" : "item";

  const createJob = await insertJob(
    serviceRole,
    {
      ...d,
      jobId: d.jobId || undefined,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData)
    },
    { methodSource }
  );

  if (createJob.error || !createJob.data) {
    console.error(createJob.error);
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(request, error(createJob.error, "Failed to insert job"))
    );
  }

  const id = createJob.data.id;

  throw redirect(path.to.jobDetails(id));
}
