import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { nonScrapQuantityValidator } from "~/services/models";
import {
  finishJobOperation,
  insertProductionQuantity
} from "~/services/operations.service";
import { path } from "~/utils/path";

/**
 * Triggers an auto-print of the entity's label when this is its first
 * operation (i.e. the entity was just minted) and the work center's
 * printer assignment has auto-print enabled.
 */
async function autoPrintFirstOperationLabel({
  serviceRole,
  trackedEntityId,
  workCenterId,
  companyId,
  userId
}: {
  serviceRole: ReturnType<typeof getCarbonServiceRole>;
  trackedEntityId: string;
  workCenterId: string | undefined;
  companyId: string;
  userId: string;
}) {
  try {
    const { data: entity } = await serviceRole
      .from("trackedEntity")
      .select("attributes")
      .eq("id", trackedEntityId)
      .single();

    const attributes = (entity?.attributes ?? {}) as Record<string, unknown>;
    const operationCount = Object.keys(attributes).filter((k) =>
      k.startsWith("Operation ")
    ).length;
    if (operationCount > 1) return;

    if (!workCenterId) return;
    const { data: workCenter } = await serviceRole
      .from("workCenter")
      .select("locationId")
      .eq("id", workCenterId)
      .single();
    const locationId = workCenter?.locationId ?? undefined;
    if (!locationId) return;

    const config = await getCachedPrinterConfig(
      serviceRole,
      companyId,
      locationId,
      "workCenter",
      workCenterId
    );
    if (config?.autoPrint ?? true) {
      await trigger("print-job", {
        sourceDocument: "Job",
        sourceDocumentId: trackedEntityId,
        companyId,
        userId,
        locationId,
        workCenterId
      });
    }
  } catch (e) {
    console.error("Auto-print failed:", e);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();

  // Get current job operation and production quantities to check if operation will be finished
  const jobOperation = await serviceRole
    .from("jobOperation")
    .select("*")
    .eq("id", validation.data.jobOperationId)
    .maybeSingle();

  if (jobOperation.error || !jobOperation.data) {
    return data(
      {},
      await flash(request, {
        ...error(jobOperation.error, "Failed to fetch job operation"),
        flash: "error"
      })
    );
  }

  const totalAccountedQuantity =
    (jobOperation.data.quantityComplete ?? 0) +
    (jobOperation.data.quantityReworked ?? 0) +
    (jobOperation.data.quantityScrapped ?? 0) +
    validation.data.quantity;

  const willBeFinished =
    totalAccountedQuantity >=
    (jobOperation.data.targetQuantity ??
      jobOperation.data.operationQuantity ??
      0);

  if (validation.data.trackingType === "Serial") {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        ...validation.data,
        companyId,
        userId
      }
    });

    const newTrackedEntityId = response.data?.newTrackedEntityId;
    // Print the entity that was just completed (from form), not the new reserved one
    const completedEntityId = validation.data.trackedEntityId;

    // Auto-print label on first operation only (entity was just minted)
    const printEntityId = completedEntityId || newTrackedEntityId;
    if (printEntityId) {
      await autoPrintFirstOperationLabel({
        serviceRole,
        trackedEntityId: printEntityId,
        workCenterId: jobOperation.data.workCenterId ?? undefined,
        companyId,
        userId
      });
    }

    const trackedEntityId = newTrackedEntityId;
    if (response.error) {
      return data(
        {},
        await flash(request, {
          ...error(response.error, "Failed to complete job operation"),
          flash: "error"
        })
      );
    }

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
        companyId
      });

      if (finishOperation.error) {
        return data(
          {},
          await flash(request, {
            ...error(finishOperation.error, "Failed to finish operation"),
            flash: "error"
          })
        );
      }

      return redirect(
        path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    if (trackedEntityId) {
      return redirect(
        `${path.to.operation(
          validation.data.jobOperationId
        )}?trackedEntityId=${trackedEntityId}`
      );
    }

    return redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else if (validation.data.trackingType === "Batch") {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationBatchComplete",
        ...validation.data,
        companyId,
        userId
      }
    });

    if (response.error) {
      return data(
        {},
        await flash(request, {
          ...error(response.error, "Failed to complete job operation"),
          flash: "error"
        })
      );
    }

    // Auto-print label on first operation only (batch entity was just minted)
    if (validation.data.trackedEntityId) {
      await autoPrintFirstOperationLabel({
        serviceRole,
        trackedEntityId: validation.data.trackedEntityId,
        workCenterId: jobOperation.data.workCenterId ?? undefined,
        companyId,
        userId
      });
    }

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
        companyId
      });

      if (finishOperation.error) {
        return data(
          {},
          await flash(request, {
            ...error(finishOperation.error, "Failed to finish operation"),
            flash: "error"
          })
        );
      }

      return redirect(
        path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    return redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else {
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    const { trackedEntityId, trackingType, ...d } = validation.data;
    const insertProduction = await insertProductionQuantity(client, {
      ...d,
      companyId,
      createdBy: userId
    });

    if (insertProduction.error) {
      return data(
        {},
        await flash(request, {
          ...error(
            insertProduction.error,
            "Failed to record production quantity"
          ),
          flash: "error"
        })
      );
    }

    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        id: validation.data.jobOperationId,
        type: "jobOperation",
        quantity: validation.data.quantity,
        companyId,
        userId
      }
    });

    if (issue.error) {
      return data(
        {},
        await flash(request, {
          ...error(issue.error, "Failed to issue materials"),
          flash: "error"
        })
      );
    }

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
        companyId
      });

      if (finishOperation.error) {
        return data(
          {},
          await flash(request, {
            ...error(finishOperation.error, "Failed to finish operation"),
            flash: "error"
          })
        );
      }

      return redirect(
        path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    return data(
      insertProduction.data,
      await flash(request, {
        ...success("Successfully completed part"),
        flash: "success"
      })
    );
  }
}
