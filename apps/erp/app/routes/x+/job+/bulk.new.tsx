import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { parseDateTime, toCalendarDateTime } from "@internationalized/date";
import { tasks } from "@trigger.dev/sdk/v3";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  bulkJobValidator,
  upsertJob,
  upsertJobMethod,
} from "~/modules/production";
import { getNextSequence } from "~/modules/settings/settings.service";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
    bypassRls: true,
  });

  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(bulkJobValidator).validate(formData);
  let jobIds: string[] = [];

  if (!validation.data) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(validation.error, "Invalid form data"))
    );
  }

  const {
    dueDateOfFirstJob,
    dueDateOfLastJob,
    scrapQuantityPerJob,
    totalQuantity,
    quantityPerJob,
    ...jobData
  } = validation.data;
  const jobs = Math.ceil(totalQuantity / quantityPerJob);
  const quantityOfLastJob = totalQuantity - (jobs - 1) * quantityPerJob;

  let configuration = undefined;
  if (jobData.configuration) {
    try {
      configuration = JSON.parse(jobData.configuration);
    } catch (error) {
      console.error(error);
    }
  }

  // Calculate due date distribution if both dates are provided
  let dueDateDistribution: string[] = [];
  if (dueDateOfFirstJob && dueDateOfLastJob) {
    const startDate = toCalendarDateTime(parseDateTime(dueDateOfFirstJob));
    const endDate = toCalendarDateTime(parseDateTime(dueDateOfLastJob));
    const daysBetween = endDate.compare(startDate);
    const daysPerJob = Math.floor(daysBetween / (jobs - 1));

    dueDateDistribution = Array.from({ length: jobs }, (_, i) => {
      if (i === jobs - 1) return dueDateOfLastJob;
      const jobDate = startDate.add({ days: i * daysPerJob });
      return jobDate.toString();
    });
  }

  for await (const [i] of Array.from({ length: jobs }, (_, i) => [i])) {
    const nextSequence = await getNextSequence(serviceRole, "job", companyId);
    if (nextSequence.error) {
      throw redirect(
        path.to.newJob,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    let jobId = nextSequence.data;

    const createJob = await upsertJob(serviceRole, {
      jobId,
      ...jobData,
      quantity: i === jobs - 1 ? quantityOfLastJob : quantityPerJob,
      scrapQuantity:
        i === jobs - 1
          ? Math.ceil(
              quantityOfLastJob * (scrapQuantityPerJob / quantityPerJob)
            )
          : scrapQuantityPerJob,
      dueDate: dueDateDistribution[i] || dueDateOfFirstJob,
      configuration,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData),
    });

    if (createJob.error) {
      throw redirect(
        path.to.newJob,
        await flash(request, error(createJob.error, "Failed to insert job"))
      );
    }

    const id = createJob.data?.id!;
    if (createJob.error || !jobId) {
      throw redirect(
        path.to.jobs,
        await flash(request, error(createJob.error, "Failed to insert job"))
      );
    }

    const upsertMethod = await upsertJobMethod(serviceRole, "itemToJob", {
      sourceId: jobData.itemId,
      targetId: id,
      companyId,
      userId,
      configuration,
    });

    if (upsertMethod.error) {
      console.error("Failed to upsert job method", upsertMethod.error);
    }
    jobIds.push(id);
  }

  await tasks.batchTrigger(
    "recalculate",
    jobIds.map((id) => ({
      payload: {
        type: "jobRequirements",
        id,
        companyId,
        userId,
      },
    }))
  );

  throw redirect(
    path.to.jobs,
    await flash(request, success(`Successfully created ${jobs} jobs`))
  );
}
