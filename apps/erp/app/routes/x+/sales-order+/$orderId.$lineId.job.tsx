import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { recalculateTask } from "@carbon/jobs/trigger/recalculate";
import { parseDate } from "@internationalized/date";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { getDefaultShelfForJob } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import {
  salesOrderToJobValidator,
  upsertJob,
  upsertJobMethod,
} from "~/modules/production";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId, lineId } = params;
  if (!orderId || !lineId) {
    throw new Error("Invalid orderId or lineId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
  });
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(salesOrderToJobValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  let jobId = validation.data.jobId;
  const useNextSequence = !jobId;
  let leadTime = 7;
  if (useNextSequence) {
    const [nextSequence, manufacturing] = await Promise.all([
      getNextSequence(serviceRole, "job", companyId),
      getItemReplenishment(serviceRole, validation.data.itemId, companyId),
    ]);
    if (nextSequence.error) {
      throw redirect(
        path.to.newJob,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    jobId = nextSequence.data;
    leadTime = manufacturing.data?.leadTime ?? 7;
  } else {
    const manufacturing = await getItemReplenishment(
      serviceRole,
      validation.data.itemId,
      companyId
    );
    leadTime = manufacturing.data?.leadTime ?? 7;
  }

  if (!jobId) throw new Error("jobId is not defined");
  const { id: _id, ...data } = validation.data;

  const shelfId = await getDefaultShelfForJob(
    serviceRole,
    validation.data.itemId,
    validation.data.locationId,
    companyId
  );

  const createJob = await upsertJob(serviceRole, {
    ...data,
    jobId,
    shelfId: shelfId ?? undefined,
    startDate: data.dueDate
      ? parseDate(data.dueDate).subtract({ days: leadTime }).toString()
      : undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  const id = createJob.data?.id!;
  if (createJob.error || !jobId) {
    console.error(createJob.error);
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(request, error(createJob.error, "Failed to insert job"))
    );
  }

  if (validation.data.quoteId && validation.data.quoteLineId) {
    const upsertMethod = await upsertJobMethod(serviceRole, "quoteLineToJob", {
      sourceId: `${data.quoteId}:${data.quoteLineId}`,
      targetId: id,
      companyId,
      userId,
    });

    if (upsertMethod.error) {
      console.error(upsertMethod.error);
      throw redirect(
        path.to.salesOrderLine(orderId, lineId),
        await flash(
          request,
          error(upsertMethod.error, "Failed to create job method.")
        )
      );
    }
  } else {
    const upsertMethod = await upsertJobMethod(serviceRole, "itemToJob", {
      sourceId: data.itemId,
      targetId: id,
      companyId,
      userId,
    });

    if (upsertMethod.error) {
      throw redirect(
        path.to.salesOrderLine(orderId, lineId),
        await flash(
          request,
          error(upsertMethod.error, "Failed to create job method.")
        )
      );
    }
  }

  await tasks.trigger<typeof recalculateTask>("recalculate", {
    type: "jobRequirements",
    id,
    companyId,
    userId,
  });

  throw redirect(path.to.jobDetails(id));
}
