// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, hasPermission, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { erpPosting } from "~/services/erp";
import { completeQuantityValidator } from "~/services/models";
import {
  abilityBlockRefusal,
  finishJobOperation,
  getRequiredScanShortfall,
  insertProductionQuantity,
  insertProductionQuantityIfCurrent
} from "~/services/operations.service";
import { autoPrintOperationLabel } from "~/services/printing.server";
import { checkStrictBackflush } from "~/services/quality.server";
import { readOrigin, withOrigin } from "~/utils/origin";
import { path } from "~/utils/path";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, permissions } = await requirePermissions(
    request,
    {}
  );

  const formData = await request.formData();
  const validation = await validator(completeQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // The page the operation was opened from; finishing returns there.
  const origin = readOrigin(formData);
  const serviceRole = await getCarbonServiceRole();

  // Get current job operation and production quantities to check if operation will be finished
  const jobOperation = await serviceRole
    .from("jobOperation")
    .select("*")
    .eq("id", validation.data.jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (jobOperation.error || !jobOperation.data) {
    log.error("Job operation not found in company", {
      companyId,
      jobOperationId: validation.data.jobOperationId,
      error: jobOperation.error
    });
    return data(
      {},
      await flash(request, {
        ...error(jobOperation.error, "Failed to fetch job operation"),
        flash: "error"
      })
    );
  }

  const refusal = await abilityBlockRefusal(serviceRole, {
    operationId: jobOperation.data.id,
    employeeId: userId,
    companyId
  });
  if (refusal) {
    return data(
      {},
      await flash(request, { ...error(null, refusal), flash: "error" })
    );
  }

  // The production event ids ride along into the productionQuantity row and
  // the issue call; RLS does not check a foreign key's tenant, so verify them.
  const productionEventIds = [
    validation.data.setupProductionEventId,
    validation.data.laborProductionEventId,
    validation.data.machineProductionEventId
  ].filter((id): id is string => Boolean(id));
  if (productionEventIds.length > 0) {
    const uniqueEventIds = [...new Set(productionEventIds)];
    const ownedEvents = await serviceRole
      .from("productionEvent")
      .select("id")
      .in("id", uniqueEventIds)
      .eq("companyId", companyId);
    if (
      ownedEvents.error ||
      (ownedEvents.data ?? []).length !== uniqueEventIds.length
    ) {
      log.error("Production event not found in company", {
        companyId,
        productionEventIds: uniqueEventIds,
        error: ownedEvents.error
      });
      return data(
        {},
        await flash(request, {
          ...error(ownedEvents.error, "Production event not found"),
          flash: "error"
        })
      );
    }
  }

  const shortfall = await getRequiredScanShortfall(serviceRole, {
    companyId,
    jobOperationId: jobOperation.data.id,
    trackedEntityId: validation.data.trackedEntityId,
    parentIsSerial: validation.data.trackingType === "Serial",
    quantity: validation.data.quantity
  });
  if (shortfall.message) {
    return data(
      {},
      await flash(request, {
        ...error(null, shortfall.message),
        flash: "error"
      })
    );
  }

  // Mirror the DB auto-Done predicate (sync_update_job_operation_quantities,
  // 20260807090629): scrap does NOT count toward targetQuantity — the op is
  // finished only once GOOD (+ reworked) quantity reaches the target.
  const totalAccountedQuantity =
    (jobOperation.data.quantityComplete ?? 0) +
    (jobOperation.data.quantityReworked ?? 0) +
    validation.data.quantity;

  const willBeFinished =
    totalAccountedQuantity >=
    (jobOperation.data.targetQuantity ??
      jobOperation.data.operationQuantity ??
      0);

  if (validation.data.trackingType === "Serial") {
    const response = await erpPosting(
      "issue",
      { companyId, userId },
      {
        type: "jobOperationSerialComplete",
        ...validation.data,
        trackedEntityId: validation.data.trackedEntityId!
      }
    );

    const newTrackedEntityId = response.data?.newTrackedEntityId as
      | string
      | undefined;
    if (response.error) {
      return data(
        {},
        await flash(request, {
          ...error(
            response.error,
            response.error.message || "Failed to complete job operation"
          ),
          flash: "error"
        })
      );
    }

    // Print the entity that was just completed (from form), not the new reserved one
    const completedEntityId = validation.data.trackedEntityId;

    // Auto-print the unit label at the first or last operation (autoPrintOperationLabel decides)
    const printEntityId = completedEntityId || newTrackedEntityId;
    if (printEntityId) {
      await autoPrintOperationLabel({
        serviceRole,
        trackedEntityId: printEntityId,
        jobOperationId: jobOperation.data.id,
        jobMakeMethodId: jobOperation.data.jobMakeMethodId,
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
        origin ?? path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    // Not finished: complete this unit and let the client (useOperation for the
    // operation view, AssemblyView for assembly ops) decide how to advance —
    // auto-select the next unit on the first operation, or open the scan/select
    // picker on later operations. Returning data (instead of redirecting to a
    // specific next unit) keeps the just-completed unit in the URL and revalidates
    // the loader, so the client is the single advancement authority and nothing
    // races it. The `{ completed: true }` marker lets AssemblyView tell a
    // successful completion apart from a failure (which returns an empty `{}`).
    return data(
      { completed: true },
      await flash(request, {
        ...success("Completed"),
        flash: "success"
      })
    );
  } else if (validation.data.trackingType === "Batch") {
    const response = await erpPosting(
      "issue",
      { companyId, userId },
      {
        type: "jobOperationBatchComplete",
        ...validation.data,
        trackedEntityId: validation.data.trackedEntityId!
      }
    );

    if (response.error) {
      return data(
        {},
        await flash(request, {
          ...error(
            response.error,
            response.error.message || "Failed to complete job operation"
          ),
          flash: "error"
        })
      );
    }

    // Auto-print the unit label at the first or last operation (autoPrintOperationLabel decides)
    if (validation.data.trackedEntityId) {
      await autoPrintOperationLabel({
        serviceRole,
        trackedEntityId: validation.data.trackedEntityId,
        jobOperationId: jobOperation.data.id,
        jobMakeMethodId: jobOperation.data.jobMakeMethodId,
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
        origin ?? path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    const operationPath = path.to.operation(validation.data.jobOperationId);
    return redirect(withOrigin(operationPath, origin));
  } else {
    const {
      // biome-ignore lint/correctness/noUnusedVariables: not a productionQuantity column
      trackedEntityId,
      // biome-ignore lint/correctness/noUnusedVariables: not a productionQuantity column
      trackingType,
      expectedQuantityComplete,
      ...d
    } = validation.data;

    const check = await checkStrictBackflush({
      jobOperationId: validation.data.jobOperationId,
      quantity: validation.data.quantity,
      companyId,
      userId
    });

    if (check.error) {
      return data(
        {},
        await flash(request, {
          ...error(check.error, check.message!),
          flash: "error"
        })
      );
    }

    let recorded: unknown;
    if (expectedQuantityComplete !== undefined) {
      // The page sent the completed quantity it showed: record the unit only
      // if no other request (a second tab, a resend) recorded it meanwhile.
      if (!hasPermission(permissions, "production", "create", companyId)) {
        return data(
          {},
          await flash(request, {
            ...error(null, "You do not have permission to record production"),
            flash: "error"
          })
        );
      }
      let inserted: { id: string } | null;
      try {
        inserted = await insertProductionQuantityIfCurrent(
          getDatabaseClient(),
          { ...d, companyId, createdBy: userId },
          expectedQuantityComplete
        );
      } catch (err) {
        log.error("Failed to record production quantity", {
          companyId,
          jobOperationId: jobOperation.data.id,
          error: err
        });
        return data(
          {},
          await flash(request, {
            ...error(err, "Failed to record production quantity"),
            flash: "error"
          })
        );
      }
      if (!inserted) {
        log.info("Completion skipped: the unit is already recorded", {
          companyId,
          jobOperationId: jobOperation.data.id,
          expectedQuantityComplete
        });
        return data({ alreadyRecorded: true });
      }
      recorded = [inserted];
    } else {
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
      recorded = insertProduction.data;
    }

    const issued = await erpPosting(
      "issue",
      { companyId, userId },
      {
        id: validation.data.jobOperationId,
        type: "jobOperation",
        quantity: validation.data.quantity
      }
    );

    if (issued.error) {
      return data(
        {},
        await flash(request, {
          ...error(
            issued.error,
            `Units completed, but ${issued.error.message || "failed to issue materials"}`
          ),
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
        origin ?? path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    return data(
      recorded,
      await flash(request, {
        ...success("Successfully completed part"),
        flash: "success"
      })
    );
  }
}
