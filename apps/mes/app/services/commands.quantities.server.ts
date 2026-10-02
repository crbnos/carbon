// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { error } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import type { WorkSource } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import type { FinishBody, QuantityBody, ScrapBody } from "@carbon/mes-core";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  finishJobOperation,
  insertProductionQuantity,
  insertReworkQuantity
} from "~/services/operations.service";
import type {
  CommandFailure,
  CommandResult,
  Failed
} from "./api-result.server";
import { failed, ok } from "./api-result.server";

/**
 * The quantity commands: report good parts, scrap, rework, and finish an
 * operation.
 *
 * Extracted verbatim from `x+/complete.tsx`, `x+/scrap.tsx`, `x+/rework.tsx`
 * and `x+/finish.tsx` so the web MES and `/api/v1` run ONE code path. See
 * `commands.server.ts` for the contract every command here keeps.
 *
 * Every failure's `details` is the exact `Result` its web route flashes today,
 * built here by calling `error(cause, message)` — so the log line (`error()`
 * logs its cause) and the flash payload (including the `flash: "error"` key,
 * which `flash()` writes to its own session key) are both byte-identical to
 * the pre-extraction route. The web route hands `details` straight to
 * `flash()`; the API reads `message` and maps `kind` through `FAILURE_STATUS`.
 */

const log = getLogger("mes");

/** Pack a web route's `Result` into a failure. See the file header. */
function flashFailure(kind: CommandFailure["kind"], result: Result): Failed {
  return failed({
    kind,
    // `Result.message` is optional in the type; `error()` always sets it,
    // defaulting to this very string.
    message: result.message ?? "Request failed",
    details: result
  });
}

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
      .eq("companyId", companyId)
      .maybeSingle();
    // Service-role read: an entity outside the caller's company prints nothing.
    if (!entity) return;

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
      .eq("companyId", companyId)
      .maybeSingle();
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
    log.error("Auto-print failed", { error: e });
  }
}

export type QuantityCommandArgs = {
  companyId: string;
  /** Who the work is attributed to — the pinned operator, else the signed-in user. */
  userId: string;
  /** The signed-in user, for parity with `requirePermissions`' own split. */
  sessionUserId: string;
  /** Which surface posted it. Telemetry only; the row cannot tell. */
  source: WorkSource;
};

export type ReportQuantityData = {
  /**
   * Which branch ran. The web route keeps four distinct responses, and only
   * the branch (not just `finished`) tells them apart.
   */
  tracking: "Serial" | "Batch" | "untracked";
  finished: boolean;
  /** The inserted rows — the untracked branch only; `null` otherwise. */
  productionQuantities: Awaited<
    ReturnType<typeof insertProductionQuantity>
  >["data"];
};

export async function reportQuantity(
  client: SupabaseClient<Database>,
  args: QuantityCommandArgs,
  body: QuantityBody
): Promise<CommandResult<ReportQuantityData>> {
  const { companyId, userId, source } = args;
  const serviceRole = await getCarbonServiceRole();

  // Get current job operation and production quantities to check if operation will be finished
  const jobOperation = await serviceRole
    .from("jobOperation")
    .select("*")
    .eq("id", body.jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (jobOperation.error || !jobOperation.data) {
    log.error("Job operation not found in company", {
      companyId,
      jobOperationId: body.jobOperationId,
      error: jobOperation.error
    });
    return flashFailure("not_found", {
      ...error(jobOperation.error, "Failed to fetch job operation"),
      flash: "error"
    });
  }

  // The production event ids ride along into the productionQuantity row and
  // the issue call; RLS does not check a foreign key's tenant, so verify them.
  const productionEventIds = [
    body.setupProductionEventId,
    body.laborProductionEventId,
    body.machineProductionEventId
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
      return flashFailure("not_found", {
        ...error(ownedEvents.error, "Production event not found"),
        flash: "error"
      });
    }
  }

  // Mirror the DB auto-Done predicate (sync_update_job_operation_quantities,
  // 20260807090629): scrap does NOT count toward targetQuantity — the op is
  // finished only once GOOD (+ reworked) quantity reaches the target.
  const totalAccountedQuantity =
    (jobOperation.data.quantityComplete ?? 0) +
    (jobOperation.data.quantityReworked ?? 0) +
    body.quantity;

  const willBeFinished =
    totalAccountedQuantity >=
    (jobOperation.data.targetQuantity ??
      jobOperation.data.operationQuantity ??
      0);

  if (body.trackingType === "Serial") {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        ...body,
        companyId,
        userId
      }
    });

    const newTrackedEntityId = response.data?.newTrackedEntityId;
    // Print the entity that was just completed (from form), not the new reserved one
    const completedEntityId = body.trackedEntityId;

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

    if (response.error) {
      return flashFailure("error", {
        ...error(response.error, "Failed to complete job operation"),
        flash: "error"
      });
    }

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
        companyId
      });

      if (finishOperation.error) {
        return flashFailure("error", {
          ...error(finishOperation.error, "Failed to finish operation"),
          flash: "error"
        });
      }

      return ok({
        tracking: "Serial",
        finished: true,
        productionQuantities: null
      });
    }

    return ok({
      tracking: "Serial",
      finished: false,
      productionQuantities: null
    });
  }

  if (body.trackingType === "Batch") {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationBatchComplete",
        ...body,
        companyId,
        userId
      }
    });

    if (response.error) {
      return flashFailure("error", {
        ...error(response.error, "Failed to complete job operation"),
        flash: "error"
      });
    }

    // Auto-print label on first operation only (batch entity was just minted)
    if (body.trackedEntityId) {
      await autoPrintFirstOperationLabel({
        serviceRole,
        trackedEntityId: body.trackedEntityId,
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
        return flashFailure("error", {
          ...error(finishOperation.error, "Failed to finish operation"),
          flash: "error"
        });
      }

      return ok({
        tracking: "Batch",
        finished: true,
        productionQuantities: null
      });
    }

    return ok({
      tracking: "Batch",
      finished: false,
      productionQuantities: null
    });
  }

  const {
    trackedEntityId: _trackedEntityId,
    trackingType: _trackingType,
    ...d
  } = body;
  const insertProduction = await insertProductionQuantity(
    client,
    {
      ...d,
      companyId,
      createdBy: userId
    },
    source
  );

  if (insertProduction.error) {
    return flashFailure("error", {
      ...error(insertProduction.error, "Failed to record production quantity"),
      flash: "error"
    });
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      id: body.jobOperationId,
      type: "jobOperation",
      quantity: body.quantity,
      companyId,
      userId
    }
  });

  if (issue.error) {
    return flashFailure("error", {
      ...error(issue.error, "Failed to issue materials"),
      flash: "error"
    });
  }

  if (willBeFinished) {
    const finishOperation = await finishJobOperation(serviceRole, {
      jobOperationId: jobOperation.data.id,
      userId,
      companyId
    });

    if (finishOperation.error) {
      return flashFailure("error", {
        ...error(finishOperation.error, "Failed to finish operation"),
        flash: "error"
      });
    }

    return ok({
      tracking: "untracked",
      finished: true,
      productionQuantities: null
    });
  }

  return ok({
    tracking: "untracked",
    finished: false,
    productionQuantities: insertProduction.data
  });
}

export type ReportScrapData = {
  scrapped: true;
  /** The replacement serial the `issue` fn spawned, for client advancement. */
  newTrackedEntityId: string | undefined;
};

/**
 * No client argument: `x+/scrap.tsx` reads none from `requirePermissions` —
 * scrap is ONE service-role `issue` `jobOperationScrap` invoke and nothing else.
 */
export async function reportScrap(
  args: QuantityCommandArgs,
  body: ScrapBody
): Promise<CommandResult<ReportScrapData>> {
  const { companyId, userId } = args;
  const {
    trackedEntityId,
    trackingType,
    jobOperationId,
    quantity,
    scrapReasonId,
    notes,
    setupProductionEventId,
    laborProductionEventId,
    machineProductionEventId
  } = body;

  // One transactional edge-function call: Scrap productionQuantity row, BOM
  // backflush, tracked-entity terminal status + replacement serial spawn
  // (serial parents), Done-operation reopen / capacity top-up beyond the
  // planned allowance, and the WIP→scrap journal.
  const issue = await getCarbonServiceRole().functions.invoke("issue", {
    body: {
      type: "jobOperationScrap",
      jobOperationId,
      quantity,
      scrapReasonId,
      notes,
      setupProductionEventId,
      laborProductionEventId,
      machineProductionEventId,
      trackedEntityId: trackingType === "Serial" ? trackedEntityId : undefined,
      companyId,
      userId
    }
  });

  if (issue.error) {
    return flashFailure(
      "error",
      error(issue.error, "Failed to record scrap quantity")
    );
  }

  // The client (useOperation / AssemblyView) advances to the spawned
  // replacement serial the same way the complete flow does.
  return ok({
    scrapped: true,
    newTrackedEntityId: issue.data?.newTrackedEntityId
  });
}

export type ReportReworkData = Awaited<
  ReturnType<typeof insertReworkQuantity>
>["data"];

export async function reportRework(
  client: SupabaseClient<Database>,
  args: QuantityCommandArgs,
  body: QuantityBody
): Promise<CommandResult<ReportReworkData>> {
  const { companyId, userId } = args;

  const insertRework = await insertReworkQuantity(client, {
    ...body,
    companyId,
    createdBy: userId
  });

  if (insertRework.error) {
    return flashFailure(
      "error",
      error(insertRework.error, "Failed to record rework quantity")
    );
  }

  return ok(insertRework.data);
}

/** No client argument: `x+/finish.tsx` writes with the service role only. */
export async function finishOperation(
  args: QuantityCommandArgs,
  body: FinishBody
): Promise<CommandResult<{ finished: true }>> {
  const { companyId, userId } = args;
  const serviceRole = await getCarbonServiceRole();

  const finishOperationResult = await finishJobOperation(serviceRole, {
    ...body,
    userId,
    companyId
  });

  if (finishOperationResult.error) {
    return flashFailure(
      "error",
      error(finishOperationResult.error, "Failed to finish operation")
    );
  }

  return ok({ finished: true });
}
