import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { CadModel, Documents } from "~/components";
import { usePermissions, useRealtime, useRouteData } from "~/hooks";
import type { Job } from "~/modules/production";
import {
  JobForm,
  jobValidator,
  recalculateJobRequirements,
  upsertJob,
} from "~/modules/production";
import JobBreadcrumbs from "~/modules/production/ui/Jobs/JobBreadcrumbs";
import type { StorageItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const recalculate = await recalculateJobRequirements(getCarbonServiceRole(), {
    id,
    companyId,
    userId,
  });
  if (recalculate.error) {
    throw redirect(
      path.to.job(id),
      await flash(
        request,
        error(recalculate.error, "Failed to recalculate job requirements")
      )
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
    files: Promise<StorageItem[]> | StorageItem[];
  }>(path.to.job(jobId));

  if (!jobData) throw new Error("Could not find job data");

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
    <VStack spacing={2} className="p-2 h-full">
      <JobBreadcrumbs />
      {/* @ts-ignore */}
      <JobForm key={jobInitialValues.id} initialValues={jobInitialValues} />
      {permissions.is("employee") && (
        <div className="grid grid-cols-1 md:grid-cols-2 w-full flex-grow gap-2">
          <CadModel
            isReadOnly={!permissions.can("update", "production")}
            metadata={{ jobId: jobData?.job?.id ?? undefined }}
            modelPath={jobData?.job?.modelPath ?? null}
            title="CAD Model"
            uploadClassName="min-h-[420px]"
            viewerClassName="min-h-[420px]"
          />

          <Suspense
            fallback={
              <Card className="flex-grow">
                <CardHeader>
                  <CardTitle>Files</CardTitle>
                </CardHeader>
                <CardContent className=""></CardContent>
              </Card>
            }
          >
            <Await resolve={jobData.files}>
              {(files) => (
                <Documents
                  files={files}
                  modelUpload={{ ...jobData.job }}
                  sourceDocument="Job"
                  sourceDocumentId={jobData.job.id ?? ""}
                  writeBucket="job"
                  writeBucketPermission="production"
                />
              )}
            </Await>
          </Suspense>
        </div>
      )}
    </VStack>
  );
}
