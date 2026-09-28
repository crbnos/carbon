import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { insertJob, salesOrderToJobValidator } from "~/modules/production";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

const logger = getLogger("erp", "orderid-lineid-job");

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

  // The service role bypasses RLS and every id below comes from the request:
  // each must belong to this company (and the line to the order in the URL)
  // before a job is written that references them. The job is attached to the
  // verified order and line, never the form's copies.
  await Promise.all([
    requireCompanyRecord(serviceRole, "salesOrderLine", companyId, {
      id: lineId,
      salesOrderId: orderId
    }),
    requireCompanyRecord(serviceRole, "item", companyId, { id: d.itemId }),
    requireCompanyRecord(serviceRole, "location", companyId, {
      id: d.locationId
    }),
    d.customerId
      ? requireCompanyRecord(serviceRole, "customer", companyId, {
          id: d.customerId
        })
      : null,
    d.quoteId
      ? requireCompanyRecord(serviceRole, "quote", companyId, { id: d.quoteId })
      : null,
    d.quoteLineId
      ? requireCompanyRecord(serviceRole, "quoteLine", companyId, {
          id: d.quoteLineId
        })
      : null,
    d.modelUploadId
      ? requireCompanyRecord(serviceRole, "modelUpload", companyId, {
          id: d.modelUploadId
        })
      : null
  ]);

  const methodSource = d.quoteId && d.quoteLineId ? "quoteLine" : "item";

  const createJob = await insertJob(
    serviceRole,
    {
      ...d,
      salesOrderId: orderId,
      salesOrderLineId: lineId,
      jobId: d.jobId || undefined,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData)
    },
    { methodSource, source: "salesOrder" }
  );

  if (createJob.error || !createJob.data) {
    logger.error("Error", { error: createJob.error });
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(request, error(createJob.error, "Failed to insert job"))
    );
  }

  const id = createJob.data.id;

  throw redirect(path.to.jobDetails(id));
}
