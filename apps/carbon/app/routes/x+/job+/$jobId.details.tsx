import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner, VStack } from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { CadModel, Documents } from "~/components";
import { usePermissions, useRealtime, useRouteData } from "~/hooks";
import type { Job } from "~/modules/production";
import {
  JobNotes,
  jobValidator,
  recalculateJobRequirements,
  upsertJob,
} from "~/modules/production";
import type { StorageItem } from "~/types";
import { setCustomFields } from "~/utils/form";
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

  return (
    <VStack spacing={2} className="p-2 h-full">
      <JobNotes
        id={jobId}
        title={jobData?.job.jobId ?? ""}
        subTitle={jobData?.job.itemReadableId ?? ""}
        notes={jobData?.job.notes as JSONContent}
      />
      {permissions.is("employee") && (
        <div className="grid grid-cols-1 2xl:grid-cols-2 w-full gap-2">
          <Suspense
            fallback={
              <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
                <Spinner className="h-10 w-10" />
              </div>
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
          <CadModel
            isReadOnly={!permissions.can("update", "production")}
            metadata={{
              jobId: jobData?.job?.id ?? undefined,
              itemId: jobData?.job?.itemId ?? undefined,
            }}
            modelPath={jobData?.job?.modelPath ?? null}
            title="CAD Model"
            uploadClassName="min-h-[420px]"
            viewerClassName="min-h-[420px]"
          />
        </div>
      )}
    </VStack>
  );
}
