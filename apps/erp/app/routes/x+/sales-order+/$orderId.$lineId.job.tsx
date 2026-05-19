import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDefaultStorageUnitForJob } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import {
  salesOrderToJobValidator,
  upsertJob,
  upsertJobMethod
} from "~/modules/production";
import { getNextSequence } from "~/modules/settings";
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
      getNextSequence("job"),
      getItemReplenishment(validation.data.itemId)
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
    const manufacturing = await getItemReplenishment(validation.data.itemId);
    leadTime = manufacturing.data?.leadTime ?? 7;
  }

  if (!jobId) throw new Error("jobId is not defined");
  const { id: _id, ...d } = validation.data;

  const storageUnitId = await getDefaultStorageUnitForJob(
    validation.data.itemId,
    validation.data.locationId
  );

  const createJob = await upsertJob({
    ...d,
    jobId,
    storageUnitId: storageUnitId ?? undefined,
    startDate: d.dueDate
      ? parseDate(d.dueDate).subtract({ days: leadTime }).toString()
      : undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
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
    const upsertMethod = await upsertJobMethod("quoteLineToJob", {
      sourceId: `${d.quoteId}:${d.quoteLineId}`,
      targetId: id
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
    const upsertMethod = await upsertJobMethod("itemToJob", {
      sourceId: d.itemId,
      targetId: id
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

  await trigger("recalculate", {
    type: "jobRequirements",
    id,
    companyId,
    userId
  });

  throw redirect(path.to.jobDetails(id));
}
