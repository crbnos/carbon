import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { batchTrigger } from "@carbon/jobs";
import { parseDateTime, toCalendarDateTime } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDefaultStorageUnitForJob } from "~/modules/inventory";
import { bulkJobValidator, insertJob } from "~/modules/production";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
    bypassRls: true
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
    totalQuantity,
    quantityPerJob,
    configuration: configStr,
    ...jobData
  } = validation.data;

  let configuration: Record<string, unknown> | undefined;
  if (configStr) {
    try {
      configuration = JSON.parse(configStr);
    } catch {
      // invalid JSON — skip configuration
    }
  }
  const jobs = Math.ceil(totalQuantity / quantityPerJob);
  const quantityOfLastJob = totalQuantity - (jobs - 1) * quantityPerJob;

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
    serviceRole,
    jobData.itemId,
    jobData.locationId,
    companyId
  );

  for await (const [i] of Array.from({ length: jobs }, (_, i) => [i])) {
    const dueDate = (dueDateDistribution[i] || dueDateOfFirstJob)?.split(
      "T"
    )[0];

    const createJob = await insertJob(
      serviceRole,
      {
        ...jobData,
        quantity: i === jobs - 1 ? quantityOfLastJob : quantityPerJob,
        dueDate,
        storageUnitId: storageUnitId ?? undefined,
        configuration,
        companyId,
        createdBy: userId,
        customFields: setCustomFields(formData)
      },
      { skipRecalculate: true }
    );

    if (createJob.error || !createJob.data) {
      throw redirect(
        path.to.newJob,
        await flash(request, error(createJob.error, "Failed to insert job"))
      );
    }

    jobIds.push(createJob.data.id);
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
