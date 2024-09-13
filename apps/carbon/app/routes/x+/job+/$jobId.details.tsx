import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import { CadModel } from "~/components";
import { usePermissions, useRealtime, useRouteData } from "~/hooks";
import type { Job } from "~/modules/production";
import { JobForm, jobValidator, upsertJob } from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production",
  });

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find jobId");

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobId, ...data } = validation.data;
  if (!jobId) throw new Error("Could not find jobId in payload");

  const updateJob = await upsertJob(client, {
    ...data,
    id: id,
    jobId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateJob.error) {
    throw redirect(
      path.to.job(id),
      await flash(request, error(updateJob.error, "Failed to update job"))
    );
  }

  throw redirect(path.to.job(id), await flash(request, success("Updated job")));
}

export default function JobDetailsRoute() {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Could not find jobId");
  const permissions = usePermissions();

  const jobData = useRouteData<{
    job: Job;
    files: FileObject[];
  }>(path.to.job(jobId));

  if (!jobData) throw new Error("Could not find job data");
  // const permissions = usePermissions();

  useRealtime("modelUpload", `modelPath=eq.(${jobData?.job.modelPath})`);

  const jobInitialValues = {
    id: jobData.job?.id ?? "",
    jobId: jobData.job?.jobId ?? "",
    customerId: jobData.job?.customerId ?? "",
    deadlineType: jobData.job?.deadlineType ?? ("No Deadline" as "No Deadline"),
    description: jobData.job?.description ?? "",
    dueDate: jobData.job?.dueDate ?? "",
    itemId: jobData.job?.itemId ?? "",
    itemType: jobData.job?.itemType ?? ("Part" as const),
    locationId: jobData.job?.locationId ?? "",
    quantity: jobData.job?.quantity ?? 0,
    scrapQuantity: jobData.job?.scrapQuantity ?? 0,
    status: jobData.job?.status ?? ("Draft" as const),
    unitOfMeasureCode: jobData.job?.unitOfMeasureCode ?? "EA",
    ...getCustomFields(jobData.job?.customFields ?? {}),
  };

  return (
    <VStack spacing={2}>
      <JobForm key={jobInitialValues.id} initialValues={jobInitialValues} />
      {permissions.is("employee") && (
        <div className="grid grid-cols-1 md:grid-cols-2 w-full flex-grow gap-2">
          <CadModel
            autodeskUrn={jobData?.job?.autodeskUrn ?? null}
            isReadOnly={!permissions.can("update", "production")}
            metadata={{ jobId: jobData?.job?.id ?? undefined }}
            modelPath={jobData?.job?.modelPath ?? null}
            title="CAD Model"
          />
          {/* <JobDocuments
            files={jobData?.files ?? []}
            jobId={jobId}
            modelUpload={jobData.job ?? undefined}
          /> */}
        </div>
      )}
    </VStack>
  );
}
