import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { batchTrigger } from "@carbon/jobs";
import {
  parseDate,
  parseDateTime,
  toCalendarDateTime
} from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDefaultStorageUnitForJob } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import {
  bulkJobValidator,
  upsertJob,
  upsertJobMethod
} from "~/modules/production";
import { getNextSequence } from "~/modules/settings/settings.service";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
    bypassRls: true
  });

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

  const manufacturing = await getItemReplenishment(jobData.itemId);

  // Calculate due date distribution if both dates are provided
  let dueDateDistribution: string[] = [];
  if (dueDateOfFirstJob && dueDateOfLastJob) {
    const startDate = toCalendarDateTime(parseDateTime(dueDateOfFirstJob));
    const endDate = toCalendarDateTime(parseDateTime(dueDateOfLastJob));
    const daysBetween = endDate.compare(startDate);

    // Determine if we have multiple jobs per day or multiple days per job
    const jobsPerDay = (jobs - 1) / daysBetween;
    const daysPerJob = daysBetween / (jobs - 1);

    if (jobsPerDay >= 1) {
      // Multiple jobs per day - distribute jobs evenly across days
      let cumulativeJobs = 0;
      dueDateDistribution = Array.from({ length: jobs }, (_, i) => {
        if (i === jobs - 1) return dueDateOfLastJob;

        cumulativeJobs += 1;
        const dayOffset = Math.floor(cumulativeJobs / jobsPerDay);
        const jobDate = startDate.add({ days: dayOffset });
        return jobDate.toString();
      });
    } else {
      // Multiple days per job - distribute days evenly across jobs
      dueDateDistribution = Array.from({ length: jobs }, (_, i) => {
        if (i === jobs - 1) return dueDateOfLastJob;

        const dayOffset = Math.floor(i * daysPerJob);
        const jobDate = startDate.add({ days: dayOffset });
        return jobDate.toString();
      });
    }
  }

  const storageUnitId = await getDefaultStorageUnitForJob(
    jobData.itemId,
    jobData.locationId
  );

  for await (const [i] of Array.from({ length: jobs }, (_, i) => [i])) {
    const nextSequence = await getNextSequence("job");
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
    const dueDate = (dueDateDistribution[i] || dueDateOfFirstJob)?.split(
      "T"
    )[0];

    const createJob = await upsertJob({
      jobId,
      ...jobData,
      quantity: i === jobs - 1 ? quantityOfLastJob : quantityPerJob,
      scrapQuantity:
        i === jobs - 1
          ? Math.ceil(
              quantityOfLastJob * (scrapQuantityPerJob / quantityPerJob)
            )
          : scrapQuantityPerJob,
      dueDate,
      startDate: dueDate
        ? parseDate(dueDate)
            .subtract({ days: manufacturing.data?.leadTime ?? 7 })
            .toString()
        : undefined,
      storageUnitId: storageUnitId ?? undefined,
      configuration,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData)
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

    const upsertMethod = await upsertJobMethod("itemToJob", {
      sourceId: jobData.itemId,
      targetId: id,
      configuration
    });

    if (upsertMethod.error) {
      console.error("Failed to upsert job method", upsertMethod.error);
    }
    jobIds.push(id);
  }

  await batchTrigger(
    "recalculate",
    jobIds.map((id) => ({
      payload: {
        type: "jobRequirements",
        id,
        companyId,
        userId
      }
    }))
  );

  throw redirect(
    path.to.jobs,
    await flash(request, success(`Successfully created ${jobs} jobs`))
  );
}
