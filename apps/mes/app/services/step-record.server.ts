// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A work-instruction step recorded for one unit (`x+/record.tsx`), or every
// step left for one unit at once (`x+/steps.complete-all.tsx`). The route
// authenticates and passes its client in.

import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { data } from "react-router";
import { stepRecordValidator } from "~/services/models";
import {
  abilityBlockRefusal,
  backflushUntrackedMaterialsOnStepRecord,
  completeAllStepsForUnit,
  getCorrectionSuggestion,
  insertAttributeRecord
} from "~/services/operations.service";
import { resolveWorkUnit } from "~/services/work-unit.server";

const log = getLogger("mes");

export async function recordStep(
  deps: { client: SupabaseClient<Database> },
  {
    request,
    companyId,
    userId
  }: { request: Request; companyId: string; userId: string }
) {
  const serviceRole = deps.client;
  const formData = await request.formData();
  const validation = await validator(stepRecordValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }
  const { trackedEntityId, ...record } = validation.data;

  // A missing step is left to insertAttributeRecord's not-found refusal.
  const step = await serviceRole
    .from("jobOperationStep")
    .select("operationId")
    .eq("id", record.jobOperationStepId)
    .eq("companyId", companyId)
    .maybeSingle();

  // A serial step is recorded for an open unit the request names; its index
  // is that unit's place in the axis. A tablet on an older page sends only
  // the index: on a first operation that still names the unit.
  const work = step.data
    ? await resolveWorkUnit({
        client: serviceRole,
        companyId,
        operationId: step.data.operationId,
        requestedUnitId: trackedEntityId,
        legacyUnitIndex: trackedEntityId ? undefined : record.index,
        mode: "require"
      })
    : null;
  if (work?.kind === "refuse") {
    return data({}, await flash(request, error(null, work.message)));
  }
  const index = work?.kind === "unit" ? work.unitIndex : record.index;

  const refusal = step.data
    ? await abilityBlockRefusal(serviceRole, {
        operationId: step.data.operationId,
        employeeId: userId,
        companyId
      })
    : null;
  if (refusal) {
    return data({}, await flash(request, error(null, refusal)));
  }

  const attributeRecord = await insertAttributeRecord(serviceRole, {
    ...record,
    index,
    companyId,
    createdBy: userId
  });

  if (attributeRecord.refusal) {
    return data({}, await flash(request, error(null, attributeRecord.refusal)));
  }

  if (attributeRecord.error) {
    return data(
      {},
      await flash(
        request,
        error(attributeRecord.error, "Failed to record attribute")
      )
    );
  }

  // Recording a step auto-issues one unit's worth of the untracked materials that
  // step owns — a step-assigned part when its step is recorded, or a loose part
  // (unassigned) on the operation's first step. The operator builds unit by unit
  // and never scans these. A backflush failure (e.g. insufficient stock) never
  // blocks the record; the part just stays manually issuable.
  const backflush = await backflushUntrackedMaterialsOnStepRecord(serviceRole, {
    jobOperationStepId: record.jobOperationStepId,
    companyId,
    userId
  });
  if (backflush.error) {
    log.error("Backflush on step record failed", {
      error: backflush.error,
      jobOperationStepId: record.jobOperationStepId
    });
  }

  // A result mapped to a correction asks the operator to confirm it.
  const correction = await getCorrectionSuggestion(serviceRole, {
    jobOperationStepId: record.jobOperationStepId,
    index,
    value: record.value,
    numericValue: record.numericValue,
    booleanValue: record.booleanValue,
    companyId
  });

  return data(
    { success: true, correction },
    await flash(request, success("Attribute recorded successfully"))
  );
}

/**
 * A manager records every step left for one unit (the route checks the
 * Production delete permission). A serial unit is the open unit the request
 * names, as for one step; the record key is its place in the axis.
 */
export async function completeAllSteps(
  deps: { client: SupabaseClient<Database> },
  {
    request,
    companyId,
    userId
  }: { request: Request; companyId: string; userId: string }
) {
  const formData = await request.formData();
  const operationId = formData.get("operationId")?.toString();
  const trackedEntityId = formData.get("trackedEntityId")?.toString() || null;
  const index = Number.parseInt(formData.get("index")?.toString() ?? "", 10);
  const missing = async () =>
    data(
      { success: false },
      await flash(request, error(null, "Missing operation or unit"))
    );
  if (!operationId) return missing();

  const work = await resolveWorkUnit({
    client: deps.client,
    companyId,
    operationId,
    requestedUnitId: trackedEntityId,
    legacyUnitIndex: trackedEntityId || Number.isNaN(index) ? undefined : index,
    mode: "require"
  });
  if (work.kind === "refuse") {
    return data(
      { success: false },
      await flash(request, error(null, work.message))
    );
  }
  const unitIndex = work.kind === "unit" ? work.unitIndex : index;
  if (Number.isNaN(unitIndex)) return missing();

  const result = await completeAllStepsForUnit(deps.client, {
    operationId,
    index: unitIndex,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to complete all steps"))
    );
  }

  if (result.data?.backflushError) {
    log.error("Backflush on complete-all override failed", {
      error: result.data.backflushError,
      operationId,
      index: unitIndex
    });
  }

  return data(
    { success: true },
    await flash(
      request,
      success(`Completed ${result.data?.count ?? 0} remaining step(s)`)
    )
  );
}
