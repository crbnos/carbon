import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import {
  JobForm,
  jobValidator,
  upsertJob,
  upsertJobMethod,
} from "~/modules/production";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import type { recalculateTask } from "~/trigger/recalculate";
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
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
  });
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let jobId = validation.data.jobId;
  const useNextSequence = !jobId;
  if (useNextSequence) {
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
    jobId = nextSequence.data;
  }

  if (!jobId) throw new Error("jobId is not defined");
  const { id: _id, ...data } = validation.data;

  const createJob = await upsertJob(serviceRole, {
    ...data,
    jobId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  const id = createJob.data?.id!;
  if (createJob.error || !jobId) {
    // TODO: this should be done as a transaction
    await rollbackNextSequence(serviceRole, "job", companyId);
    throw redirect(
      path.to.jobs,
      await flash(request, error(createJob.error, "Failed to insert job"))
    );
  }

  const upsertMethod = await upsertJobMethod(serviceRole, "itemToJob", {
    sourceId: data.itemId,
    targetId: id,
    companyId,
    userId,
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
    itemType: "Part" as const,
    jobId: undefined,
    locationId: defaults?.locationId ?? "",
    quantity: 0,
    scrapQuantity: 0,
    status: "Draft" as const,
    unitOfMeasureCode: "EA",
  };

  return (
    <div className="max-w-[50rem] w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <JobForm initialValues={initialValues} />
    </div>
  );
}
