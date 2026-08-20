import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  getJob,
  getJobOperations,
  isJobLocked,
  productionQuantityValidator,
  upsertProductionQuantity
} from "~/modules/production";
import { ProductionQuantityForm } from "~/modules/production/ui/Jobs";
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
      value: operation.id
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

  const validation = await validator(productionQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  // If the type is not Scrap, clear the scrapReasonId
  if (d.type !== "Scrap") {
    d.scrapReasonId = undefined;
  }

  const insert = await upsertProductionQuantity(client, {
    ...d,
    companyId
  });

  if (!insert.error && insert.data?.id) {
    // Back-office entry, not the shop floor. The source property is what makes
    // the MES-vs-ERP ratio readable — a clerk typing yesterday's paper
    // traveller in here is a different fact from an operator on a station.
    const common = {
      companyId,
      userId,
      productionQuantityId: insert.data.id,
      jobOperationId: d.jobOperationId,
      quantity: d.quantity,
      source: "erp" as const
    };
    if (d.type === "Scrap") {
      trackWorkEvent("scrap_reported", {
        ...common,
        scrapReasonId: d.scrapReasonId ?? null
      });
    } else if (d.type === "Production") {
      trackWorkEvent("production_quantity_reported", common);
    }
  }

  if (insert.error) {
    return data(
      {},
      await flash(
        request,
        error(insert.error, "Failed to insert production quantity")
      )
    );
  }

  return modal
    ? data(insert, { status: 201 })
    : redirect(
        `${path.to.jobProductionQuantities(jobId)}?${getParams(request)}`,
        await flash(request, success("Production quantity created"))
      );
}

export default function NewProductionQuantityRoute() {
  const { operationOptions } = useLoaderData<typeof loader>();
  const initialValues = {
    type: "Production" as const,
    jobOperationId: "",
    quantity: 0,
    scrapReasonId: "",
    notes: "",
    createdBy: ""
  };

  return (
    <ProductionQuantityForm
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
