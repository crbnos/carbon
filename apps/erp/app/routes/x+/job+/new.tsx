import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import { getDefaultStorageUnitForJob } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import {
  calculateJobPriority,
  jobValidator,
  upsertJob,
  upsertJobMethod
} from "~/modules/production";
import { JobForm } from "~/modules/production/ui/Jobs";
import { getNextSequence } from "~/modules/settings";
import type { MethodItemType } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.jobs,
  module: "production"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
    role: "employee"
  });

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let jobId = validation.data.jobId;
  const useNextSequence = !jobId;

  // Fetch manufacturing data for lead time and scrap percentage
  const [nextSequenceResult, manufacturing] = await Promise.all([
    useNextSequence
      ? getNextSequence("job")
      : Promise.resolve({ data: null, error: null }),
    getItemReplenishment(validation.data.itemId)
  ]);

  if (useNextSequence) {
    if (nextSequenceResult.error) {
      throw redirect(
        path.to.newJob,
        await flash(
          request,
          error(nextSequenceResult.error, "Failed to get next sequence")
        )
      );
    }
    // @ts-expect-error TS2322 - TODO: fix type
    jobId = nextSequenceResult.data;
  }

  const leadTime = manufacturing.data?.leadTime ?? 7;

  if (!jobId) throw new Error("jobId is not defined");
  const { id: _id, ...d } = validation.data;

  // Calculate scrap quantity from the item's scrap percentage if not set
  const scrapPercentage = manufacturing.data?.scrapPercentage ?? 0;
  const calculatedScrapQuantity =
    scrapPercentage > 0
      ? Math.ceil(validation.data.quantity * scrapPercentage)
      : 0;
  // Use the form value if set, otherwise use calculated value
  const scrapQuantity =
    d.scrapQuantity && d.scrapQuantity > 0
      ? d.scrapQuantity
      : calculatedScrapQuantity;

  let configuration = undefined;
  if (d.configuration) {
    try {
      configuration = JSON.parse(d.configuration);
    } catch (error) {
      console.error(error);
    }
  }

  const storageUnitId = await getDefaultStorageUnitForJob(
    validation.data.itemId,
    validation.data.locationId
  );

  // Calculate priority based on due date and deadline type
  const priority = await calculateJobPriority({
    dueDate: d.dueDate ?? null,
    deadlineType: d.deadlineType,
    locationId: validation.data.locationId
  });

  const createJob = await upsertJob({
    ...d,
    jobId,
    configuration,
    // @ts-expect-error TS2353 - TODO: fix type
    priority,
    scrapQuantity,
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
    throw redirect(
      path.to.jobs,
      await flash(request, error(createJob.error, "Failed to insert job"))
    );
  }

  const upsertMethod = await upsertJobMethod("itemToJob", {
    sourceId: d.itemId,
    targetId: id,
    configuration
  });

  if (upsertMethod.error) {
    throw redirect(
      path.to.job(id),
      await flash(
        request,
        error(upsertMethod.error, "Failed to create job method.")
      )
    );
  }

  await trigger("recalculate", {
    type: "jobRequirements",
    id,
    companyId,
    userId
  });

  throw redirect(path.to.job(id));
}

export default function JobNewRoute() {
  const { defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");

  const initialValues = {
    customerId: customerId ?? "",
    deadlineType: "No Deadline" as const,
    description: "",
    dueDate: "",
    itemId: "",
    itemType: "Item" as MethodItemType,
    jobId: undefined,
    locationId: defaults?.locationId ?? "",
    quantity: 1,
    scrapQuantity: 0,
    status: "Draft" as const,
    unitOfMeasureCode: "EA"
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <JobForm initialValues={initialValues} />
    </div>
  );
}
