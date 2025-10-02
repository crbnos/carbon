import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { recalculateTask } from "@carbon/jobs/trigger/recalculate";
import { parseDate } from "@internationalized/date";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import { getDefaultShelfForJob } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import { jobValidator, upsertJob, upsertJobMethod } from "~/modules/production";
import { JobForm } from "~/modules/production/ui/Jobs";
import { getNextSequence } from "~/modules/settings";
import type { MethodItemType } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
  module: "production",
};

export const config = { runtime: "nodejs" };

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
    role: "employee",
  });

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let jobId = validation.data.jobId;
  const useNextSequence = !jobId;
  let leadTime = 7;

  if (useNextSequence) {
    const [nextSequence, manufacturing] = await Promise.all([
      getNextSequence(client, "job", companyId),
      getItemReplenishment(client, validation.data.itemId, companyId),
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
      client,
      validation.data.itemId,
      companyId
    );
    leadTime = manufacturing.data?.leadTime ?? 7;
  }

  if (!jobId) throw new Error("jobId is not defined");
  const { id: _id, ...data } = validation.data;

  let configuration = undefined;
  if (data.configuration) {
    try {
      configuration = JSON.parse(data.configuration);
    } catch (error) {
      console.error(error);
    }
  }

  const shelfId = await getDefaultShelfForJob(
    client,
    validation.data.itemId,
    validation.data.locationId,
    companyId
  );

  const createJob = await upsertJob(client, {
    ...data,
    jobId,
    configuration,
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
    throw redirect(
      path.to.jobs,
      await flash(request, error(createJob.error, "Failed to insert job"))
    );
  }

  const upsertMethod = await upsertJobMethod(
    getCarbonServiceRole(),
    "itemToJob",
    {
      sourceId: data.itemId,
      targetId: id,
      companyId,
      userId,
      configuration,
    }
  );

  if (upsertMethod.error) {
    throw redirect(
      path.to.job(id),
      await flash(
        request,
        error(upsertMethod.error, "Failed to create job method.")
      )
    );
  }

  await tasks.trigger<typeof recalculateTask>("recalculate", {
    type: "jobRequirements",
    id,
    companyId,
    userId,
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
    unitOfMeasureCode: "EA",
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <JobForm initialValues={initialValues} />
    </div>
  );
}
