import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  getJob,
  getJobOperations,
  isJobLocked,
  productionEventValidator,
  upsertProductionEvent
} from "~/modules/production";
import { ProductionEventForm } from "~/modules/production/ui/Jobs";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) throw notFound("jobId not found");

  const jobOperations = await getJobOperations(client, jobId);

  const operationOptions =
    jobOperations.data?.map((operation) => ({
      label: operation.description ?? "",
      value: operation.id,
      processId: operation.processId
    })) ?? [];

  return { operationOptions };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) {
    throw notFound("jobId not found");
  }

  const { client: viewClient } = await requirePermissions(request, {
    view: "production"
  });
  const job = await getJob(viewClient, jobId);
  await requireUnlocked({
    request,
    isLocked: isJobLocked(job.data?.status),
    redirectTo: path.to.job(jobId),
    message: "Cannot modify a locked job. Reopen it first."
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insert = await upsertProductionEvent(client, {
    ...d,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      {},
      await flash(
        request,
        error(insert.error, "Failed to insert production event")
      )
    );
  }

  let postingError: string | null = null;
  if (d.endTime) {
    const serviceRole = await getCarbonServiceRole();
    const posting = await serviceRole.functions.invoke<{
      success: boolean;
      reason?: string;
      error?: string;
    }>("post-production-event", {
      body: {
        productionEventId: insert.data.id,
        userId,
        companyId
      }
    });
    if (posting.error) {
      postingError = posting.error.message;
    } else if (posting.data && posting.data.success === false) {
      postingError = posting.data.reason ?? "unknown reason";
    }
  }

  return modal
    ? data(insert, { status: 201 })
    : redirect(
        `${path.to.jobProductionEvents(jobId)}?${getParams(request)}`,
        await flash(
          request,
          postingError
            ? error(
                postingError,
                `Production event created, but no journal entry was posted: ${postingError}`
              )
            : success("Production event created")
        )
      );
}

export default function NewProductionEventRoute() {
  const { operationOptions } = useLoaderData<typeof loader>();
  const initialValues = {
    type: "Labor" as const,
    jobOperationId: "",
    startTime: new Date(new Date().setHours(8, 0, 0, 0)).toISOString(),
    employeeId: "",
    workCenterId: "",
    notes: ""
  };

  return (
    <ProductionEventForm
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
