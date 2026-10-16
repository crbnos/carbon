// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import { isUnsafeStoragePath, storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { postSuggestionToCarbonSlack } from "@carbon/lib/slack.server";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { serverFns } from "@carbon/server-functions";
import { datetime, unchecked } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { notifyScheduleInputsChanged } from "~/modules/production/production.service";
import {
  CarbonError,
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import { getCompany } from "~/modules/settings/settings.service";
import { refuseUnlessOwned } from "~/modules/shared/shared.server";
import { invalidateLocationTimeZone } from "~/modules/shared/timezone.server";
import {
  abilityValidator,
  employeeAbilityCellValidator,
  isMaintenanceDispatchLocked,
  isValidTrainingGuideKey,
  locationValidator,
  maintenanceDispatchEventValidator,
  maintenanceDispatchStatus,
  maintenanceDispatchValidator,
  maintenanceScheduleValidator,
  processValidator,
  trainingAssignmentValidator,
  trainingCertificateKeyPrefix,
  trainingGuideKeyPrefix,
  validateTrainingCertificate,
  workCenterValidator
} from "./resources.models";
import {
  activateWorkCenter,
  deleteAbility,
  deleteTrainingCompletion,
  deleteWorkCenter,
  ensureProcessAbility,
  getTrainingAssignment,
  getTrainingAssignments,
  getTrainingGrantedAbilityId,
  insertMaintenanceDispatch,
  insertTrainingCompletion,
  resolveEmployeeAbilityExpiresAt,
  upsertEmployeeAbilityCell,
  upsertLocation,
  upsertMaintenanceDispatchEvent,
  upsertMaintenanceSchedule,
  upsertProcess,
  upsertTrainingAssignment,
  upsertWorkCenter
} from "./resources.service";

const logger = getLogger("erp", "resources");

// Reconcile the dispatches' labor postings with their time entries (the
// post-maintenance-event server function — idempotent, so call it after ANY
// change to a dispatch's entries or its completion). Returns the failure's
// message, or null. System: the operation has already authorized the change,
// and a delete-only user must still reverse its cost.
async function postMaintenanceLabor(
  ctx: ServiceContext,
  maintenanceDispatchIds: string[]
): Promise<string | null> {
  if (maintenanceDispatchIds.length === 0) return null;

  const posting = await serverFns
    .system({
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    })
    .invoke("post-maintenance-event", { maintenanceDispatchIds });

  if (posting.error) {
    logger.error("Failed to post maintenance labor", {
      companyId: ctx.company.id,
      maintenanceDispatchIds,
      error: posting.error
    });
    return posting.error.message || "Failed to post maintenance labor";
  }
  return null;
}

const trainingLogger = getLogger("erp", "training-completion");

// An external assignment (no training) is always open and one-time.
type AssignmentForCompletion = {
  trainingId: string | null;
  training: {
    status: string;
    frequency: Database["public"]["Enums"]["trainingFrequency"];
  } | null;
};

// The only completion path (quiz, manager Mark Complete). An external
// assignment may carry a certificate; the server builds its key, so a caller
// cannot point a completion at another person's file.
export async function recordTrainingCompletion(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    trainingAssignmentId: string;
    employeeId: string;
    completedBy: string;
    assignment: AssignmentForCompletion;
    certificate?: FormDataEntryValue | null;
  }
): Promise<{ error: null } | { error: string; status: 400 | 500 }> {
  const { companyId, trainingAssignmentId, employeeId, completedBy } = args;
  const isExternal = args.assignment.trainingId === null;
  const training = args.assignment.training;

  if (!isExternal && training?.status !== "Active") {
    return { error: "This training is not currently active", status: 400 };
  }

  let certificatePath: string | null = null;
  const hasCertificate =
    args.certificate instanceof File && args.certificate.size > 0;
  if (isExternal && hasCertificate) {
    const certificate = await validateTrainingCertificate(
      args.certificate ?? null
    );
    if (certificate.error !== null) {
      return { error: certificate.error, status: 400 };
    }
    const key = `${trainingCertificateKeyPrefix(
      companyId,
      trainingAssignmentId,
      employeeId
    )}${nanoid()}.${certificate.extension}`;
    const upload = await storage(client)
      .company(companyId)
      .upload(key, certificate.file);
    if (upload.error) {
      trainingLogger.error("Failed to upload training certificate", {
        companyId,
        trainingAssignmentId,
        error: upload.error
      });
      return { error: "Failed to upload the certificate", status: 500 };
    }
    certificatePath = key;
  }

  const period = await client.rpc("get_current_training_period", {
    frequency: training?.frequency ?? "Once"
  });

  const completion = await insertTrainingCompletion(client, {
    trainingAssignmentId,
    employeeId,
    period: period.data ?? null,
    companyId,
    completedBy,
    createdBy: completedBy,
    certificatePath
  });
  if (completion.error) {
    // The unique indexes allow one completion per employee and period: a
    // second submit means it is already recorded, which is what was asked.
    const alreadyRecorded = completion.error.code === "23505";
    if (!alreadyRecorded) {
      trainingLogger.error("Failed to record training completion", {
        companyId,
        trainingAssignmentId,
        error: completion.error
      });
    }
    // Nothing points at the new file now.
    if (certificatePath) {
      const removed = await storage(client)
        .company(companyId)
        .remove([certificatePath]);
      if (removed.error) {
        trainingLogger.error("Failed to remove orphaned certificate", {
          companyId,
          certificatePath,
          error: removed.error
        });
      }
    }
    return alreadyRecorded
      ? { error: null }
      : { error: "Failed to record the training as complete", status: 500 };
  }

  // Completing a training that grants an ability adds a qualification (via the
  // grant trigger) — restamp the scheduler for that ability's operator pool.
  const grantedAbilityId = await getTrainingGrantedAbilityId(
    client,
    trainingAssignmentId,
    companyId
  );
  if (grantedAbilityId) {
    await notifyScheduleInputsChanged(
      companyId,
      "ability",
      "Operator qualified via training",
      grantedAbilityId
    );
  }

  return { error: null };
}

/** The `custom-*` fields of a form, by field id (`setCustomFields`). */
const customFieldsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

/**
 * Create the ability for a process.
 *
 * @remarks
 * An ability IS a process's qualification: the process must be this
 * company's, and creating its ability turns `requiresAbility` on for it. The
 * ability is found or created (`ensureProcessAbility`), so a process never
 * gets two. The scheduler is told, because the gate changes the operator pool
 * of every job on the process.
 *
 * @mcp
 */
export const createAbility = defineServiceFn({
  input: abilityValidator,
  permission: { create: "resources" },

  async run(ctx, { processId, recertifyEveryDays }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const gated = await client
      .from("process")
      .update({ requiresAbility: true, updatedBy: ctx.auditUserId })
      .eq("id", processId)
      .eq("companyId", companyId)
      .select("id");
    if (gated.error) {
      return ctx.error("internal", "Failed to create ability", gated.error);
    }
    if (gated.data.length === 0) {
      return ctx.error("notFound", "Process not found");
    }

    const ability = await ensureProcessAbility(client, {
      processId,
      companyId,
      userId: ctx.auditUserId,
      recertifyEveryDays: recertifyEveryDays ?? null
    });
    if (ability.error || !ability.data) {
      return ctx.error("internal", "Failed to create ability", ability.error);
    }

    await notifyScheduleInputsChanged(
      companyId,
      "ability",
      "Ability created",
      ability.data.id
    );
    return { id: ability.data.id };
  }
});

/**
 * Deactivate an ability.
 *
 * @remarks
 * A soft delete: requirement tables still reference the ability. Deactivating
 * it un-gates any process that required it, so the scheduler is told.
 *
 * @mcp
 */
export const deactivateAbility = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { id }) {
    const deactivated = await deleteAbility(ctx.asCaller.supabase, id, false);
    if (deactivated.error) {
      return ctx.error(
        "internal",
        "Failed to deactivate ability",
        deactivated.error
      );
    }

    await notifyScheduleInputsChanged(
      ctx.company.id,
      "ability",
      "Ability deactivated",
      id
    );
    return { id };
  }
});

/** Qualify an employee for an ability, then tell the scheduler. */
async function saveEmployeeAbility(
  ctx: ServiceContext,
  input: z.output<typeof employeeAbilityCellValidator>,
  { failure, reason }: { failure: string; reason: string }
) {
  const { employeeId, abilityId } = input;
  const client = ctx.asCaller.supabase;
  const refused = await refuseUnlessOwned(ctx, "ability", { id: abilityId });
  if (refused) return refused;

  const lastTrainingDate = input.lastTrainingDate ?? null;
  const expiresAt = await resolveEmployeeAbilityExpiresAt(
    client,
    abilityId,
    lastTrainingDate,
    input.expiresAt ?? null
  );

  const upsert = await upsertEmployeeAbilityCell(client, {
    employeeId,
    abilityId,
    companyId: ctx.company.id,
    lastTrainingDate,
    expiresAt
  });
  if (upsert.error) return ctx.error("internal", failure, upsert.error);

  await notifyScheduleInputsChanged(
    ctx.company.id,
    "ability",
    reason,
    abilityId
  );
  return { id: upsert.data.id };
}

/**
 * Qualify an employee for an ability.
 *
 * @remarks
 * The ability must be this company's. Without an explicit `expiresAt`, the
 * expiry is the last training date plus the ability's recertification period
 * (none when the ability never expires). An employee already qualified keeps
 * one row, with these dates. The scheduler is told: the operator pool of the
 * ability's process changes.
 *
 * @mcp
 */
export const addEmployeeAbility = defineServiceFn({
  input: employeeAbilityCellValidator,
  permission: { update: "resources" },

  async run(ctx, input) {
    return saveEmployeeAbility(ctx, input, {
      failure: "Failed to add employee to ability",
      reason: "Operator qualification added"
    });
  }
});

/**
 * Update an employee's qualification for an ability.
 *
 * @remarks
 * The same write as `addEmployeeAbility`: the ability must be this company's,
 * and a blank `expiresAt` is worked out from the last training date and the
 * ability's recertification period. The scheduler is told.
 *
 * @mcp
 */
export const updateEmployeeAbility = defineServiceFn({
  input: employeeAbilityCellValidator,
  permission: { update: "resources" },

  async run(ctx, input) {
    return saveEmployeeAbility(ctx, input, {
      failure: "Failed to update employee ability",
      reason: "Operator qualification updated"
    });
  }
});

/**
 * Remove an employee from an ability.
 *
 * @remarks
 * A hard delete of the qualification row, which must belong to `abilityId`.
 * The employee can be added again later. The scheduler is told.
 *
 * @mcp destructive
 */
export const removeEmployeeAbility = defineServiceFn({
  input: z.object({ abilityId: z.string(), employeeAbilityId: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { abilityId, employeeAbilityId }) {
    const removed = await ctx.asCaller.supabase
      .from("employeeAbility")
      .delete()
      .eq("id", employeeAbilityId)
      .eq("abilityId", abilityId)
      .eq("companyId", ctx.company.id);
    if (removed.error) {
      return ctx.error(
        "internal",
        "Failed to remove employee from ability",
        removed.error
      );
    }

    await notifyScheduleInputsChanged(
      ctx.company.id,
      "ability",
      "Operator qualification removed",
      abilityId
    );
    return { id: employeeAbilityId };
  }
});

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * Create a location.
 *
 * @mcp
 */
export const createLocation = defineServiceFn({
  input: locationValidator.safeExtend({ customFields: customFieldsInput }),
  permission: { create: "resources" },

  async run(ctx, { id: _id, ...location }) {
    const insert = await upsertLocation(ctx.asCaller.supabase, {
      ...location,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (insert.error || !insert.data) {
      return ctx.error("internal", "Failed to create location.", insert.error);
    }
    return { id: insert.data.id };
  }
});

/**
 * Update a location.
 *
 * @remarks
 * The location's timezone may change, so its cached timezone is dropped.
 *
 * @mcp
 */
export const updateLocation = defineServiceFn({
  input: locationValidator.safeExtend({
    id: z.string(),
    customFields: customFieldsInput
  }),
  permission: { create: "resources" },

  async run(ctx, { id, ...location }) {
    const update = await upsertLocation(ctx.asCaller.supabase, {
      id,
      ...location,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update location.", update.error);
    }

    await invalidateLocationTimeZone(id, ctx.company.id);
    return { id };
  }
});

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

const processInput = processValidator.safeExtend({
  customFields: customFieldsInput
});

/**
 * Create a process.
 *
 * @remarks
 * Saves the process and links its work centers. When `requiresAbility` is on,
 * the process's ability is created; if that fails, `requiresAbility` is turned
 * off again, so no process gates scheduling on a qualification nobody can
 * hold.
 *
 * @mcp
 */
export const createProcess = defineServiceFn({
  input: processInput,
  permission: { create: "resources" },

  async run(ctx, { id: _id, ...process }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const insert = await upsertProcess(client, {
      ...process,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (insert.error || !insert.data?.id) {
      return ctx.error("internal", "Failed to create process.", insert.error);
    }
    const id = insert.data.id;

    if (process.requiresAbility) {
      const ability = await ensureProcessAbility(client, {
        processId: id,
        companyId,
        userId: ctx.auditUserId
      });
      if (ability.error) {
        await client
          .from("process")
          .update({ requiresAbility: false })
          .eq("id", id)
          .eq("companyId", companyId);
        return ctx.error(
          "internal",
          "Failed to create process ability.",
          ability.error
        );
      }
    }
    return { id };
  }
});

/**
 * Update a process.
 *
 * @remarks
 * Saves the process and replaces its work centers. Turning `requiresAbility`
 * on creates the process's ability; if that fails, `requiresAbility` goes back
 * to what it was. When `requiresAbility` changes, the scheduler is told, by
 * the process's ability when there is one, else company-wide.
 *
 * @mcp
 */
export const updateProcess = defineServiceFn({
  input: processInput.safeExtend({ id: z.string() }),
  permission: { create: "resources" },

  async run(ctx, { id, ...process }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const existing = await client
      .from("process")
      .select("requiresAbility")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (existing.error) {
      return ctx.error("internal", "Failed to update process.", existing.error);
    }
    if (!existing.data) return ctx.error("notFound", "Process not found");
    const previouslyRequiredAbility = existing.data.requiresAbility ?? false;

    const update = await upsertProcess(client, {
      id,
      ...process,
      companyId,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update process.", update.error);
    }

    let abilityId: string | undefined;
    if (process.requiresAbility) {
      const ability = await ensureProcessAbility(client, {
        processId: id,
        companyId,
        userId: ctx.auditUserId
      });
      if (ability.error) {
        await client
          .from("process")
          .update({ requiresAbility: previouslyRequiredAbility })
          .eq("id", id)
          .eq("companyId", companyId);
        return ctx.error(
          "internal",
          "Failed to create process ability.",
          ability.error
        );
      }
      abilityId = ability.data?.id;
    } else if (previouslyRequiredAbility) {
      const ability = await client
        .from("ability")
        .select("id")
        .eq("processId", id)
        .eq("companyId", companyId)
        .maybeSingle();
      abilityId = ability.data?.id;
    }

    const requiresAbility = process.requiresAbility ?? false;
    if (requiresAbility !== previouslyRequiredAbility) {
      // The gate changes for every job with an unfinished operation on this
      // process. Scope the notice to the ability when it resolves; otherwise
      // mark company-wide, so the notice never silently does nothing.
      const reason = requiresAbility
        ? `Process "${process.name}" now requires an ability`
        : `Process "${process.name}" no longer requires an ability`;
      if (abilityId) {
        await notifyScheduleInputsChanged(
          companyId,
          "ability",
          reason,
          abilityId
        );
      } else {
        await notifyScheduleInputsChanged(companyId, "reorder", reason);
      }
    }
    return { id };
  }
});

// ---------------------------------------------------------------------------
// Work centers
// ---------------------------------------------------------------------------

const workCenterInput = workCenterValidator.safeExtend({
  customFields: customFieldsInput
});

/**
 * Create a work center.
 *
 * @remarks
 * Saves the work center with its processes and shifts, then tells the
 * scheduler: its hours are new capacity.
 *
 * @mcp
 */
export const createWorkCenter = defineServiceFn({
  input: workCenterInput,
  permission: { update: "resources" },

  async run(ctx, { id: _id, ...workCenter }) {
    const insert = await upsertWorkCenter(ctx.asCaller.supabase, {
      ...workCenter,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (insert.error || !insert.data?.id) {
      return ctx.error(
        "internal",
        "Failed to create work center",
        insert.error
      );
    }

    await notifyScheduleInputsChanged(
      ctx.company.id,
      "work-center",
      "Work center hours changed",
      insert.data.id
    );
    return { id: insert.data.id };
  }
});

/**
 * Update a work center.
 *
 * @remarks
 * Saves the work center and replaces its processes and shifts, then tells
 * the scheduler: its hours may have changed.
 *
 * @mcp
 */
export const updateWorkCenter = defineServiceFn({
  input: workCenterInput.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, ...workCenter }) {
    const update = await upsertWorkCenter(ctx.asCaller.supabase, {
      id,
      ...workCenter,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update work center",
        update.error
      );
    }

    await notifyScheduleInputsChanged(
      ctx.company.id,
      "work-center",
      "Work center hours changed",
      id
    );
    return { id };
  }
});

/**
 * Reactivate a work center.
 *
 * @remarks
 * Its hours return to the schedule, so the scheduler is told.
 *
 * @mcp
 */
export const reactivateWorkCenter = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { id }) {
    const activated = await activateWorkCenter(ctx.asCaller.supabase, id);
    if (activated.error) {
      return ctx.error(
        "internal",
        "Failed to activate work center",
        activated.error
      );
    }

    await notifyScheduleInputsChanged(
      ctx.company.id,
      "work-center",
      "Work center reactivated",
      id
    );
    return { id };
  }
});

/**
 * Deactivate a work center.
 *
 * @remarks
 * A soft delete (`active: false`): job operations and schedules still
 * reference it. Its hours leave the schedule, so the scheduler is told.
 *
 * @mcp
 */
export const deactivateWorkCenter = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { id }) {
    const deactivated = await deleteWorkCenter(ctx.asCaller.supabase, id);
    if (deactivated.error) {
      return ctx.error(
        "internal",
        deactivated.error.details || "Failed to deactivate work center",
        deactivated.error
      );
    }

    await notifyScheduleInputsChanged(
      ctx.company.id,
      "work-center",
      "Work center deactivated",
      id
    );
    return { id };
  }
});

// ---------------------------------------------------------------------------
// Maintenance schedules
// ---------------------------------------------------------------------------

/**
 * Create a preventive maintenance schedule.
 *
 * @remarks
 * Then generates its dispatches and next due date now, so it shows on the
 * maintenance displays without waiting for the nightly run.
 *
 * @mcp
 */
export const createMaintenanceSchedule = defineServiceFn({
  input: maintenanceScheduleValidator,
  permission: { create: "resources" },

  async run(ctx, { id: _id, ...schedule }) {
    const insert = await upsertMaintenanceSchedule(ctx.asCaller.supabase, {
      ...schedule,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (insert.error || !insert.data?.id) {
      return ctx.error(
        "internal",
        "Failed to create maintenance schedule",
        insert.error
      );
    }

    await trigger("generate-maintenance", {
      companyId: ctx.company.id,
      scheduleId: insert.data.id
    });
    return { id: insert.data.id };
  }
});

/**
 * Update a preventive maintenance schedule.
 *
 * @remarks
 * Then generates its dispatches again, so a change of frequency, active or
 * day of week shows on the maintenance displays without waiting for the
 * nightly run.
 *
 * @mcp
 */
export const updateMaintenanceSchedule = defineServiceFn({
  input: maintenanceScheduleValidator.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, ...schedule }) {
    const update = await upsertMaintenanceSchedule(ctx.asCaller.supabase, {
      id,
      ...schedule,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update maintenance schedule",
        update.error
      );
    }

    await trigger("generate-maintenance", {
      companyId: ctx.company.id,
      scheduleId: id
    });
    return { id };
  }
});

// ---------------------------------------------------------------------------
// Maintenance dispatches
// ---------------------------------------------------------------------------

const DISPATCH_LOCKED = "Cannot modify a locked dispatch. Reopen it first.";

/** The dispatch, when it is this company's and not Completed or Cancelled. */
async function editableDispatch(ctx: ServiceContext, dispatchId: string) {
  const dispatch = await ctx.asCaller.supabase
    .from("maintenanceDispatch")
    .select("id, status, workCenterId")
    .eq("id", dispatchId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (dispatch.error) {
    return ctx.error("internal", "Failed to load the dispatch", dispatch.error);
  }
  if (!dispatch.data) return ctx.error("notFound", "Dispatch not found");
  if (isMaintenanceDispatchLocked(dispatch.data.status)) {
    return ctx.error("rule", DISPATCH_LOCKED);
  }
  return dispatch.data;
}

/**
 * Create a maintenance dispatch.
 *
 * @remarks
 * Takes the next dispatch number. `content` is the notes document as JSON. A
 * dispatch that takes its work center offline removes hours from the
 * schedule, so the scheduler is told.
 *
 * @mcp
 */
export const createMaintenanceDispatch = defineServiceFn({
  input: maintenanceDispatchValidator,
  permission: { create: "resources" },

  async run(ctx, input) {
    let content: Json | undefined;
    if (input.content) {
      try {
        content = JSON.parse(input.content);
      } catch {
        return ctx.error("validation", "The dispatch notes are not valid");
      }
    }

    const result = await insertMaintenanceDispatch(ctx.asCaller.supabase, {
      status: input.status,
      priority: input.priority,
      severity: input.severity || undefined,
      source: input.source || undefined,
      oeeImpact: input.oeeImpact || undefined,
      workCenterId: input.workCenterId || undefined,
      locationId: input.locationId,
      assignee: input.assignee || undefined,
      suspectedFailureModeId: input.suspectedFailureModeId || undefined,
      plannedStartTime: input.plannedStartTime || undefined,
      plannedEndTime: input.plannedEndTime || undefined,
      takesWorkCenterOffline: input.takesWorkCenterOffline,
      content,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (result.error || !result.data) {
      return ctx.error(
        "internal",
        "Failed to create maintenance dispatch",
        result.error
      );
    }

    if (input.takesWorkCenterOffline && input.workCenterId) {
      await notifyScheduleInputsChanged(
        ctx.company.id,
        "work-center",
        "Machine downtime changed",
        input.workCenterId
      );
    }
    return result.data;
  }
});

const dispatchValueFields = [
  "priority",
  "severity",
  "source",
  "status",
  "oeeImpact",
  "suspectedFailureModeId",
  "actualFailureModeId",
  "procedureId",
  "workCenterId"
] as const;

const dispatchTimeFields = [
  "plannedStartTime",
  "plannedEndTime",
  "actualStartTime",
  "actualEndTime"
] as const;

// Field changes that can move a work center's downtime window.
const scheduleAffectingFields = new Set<string>([
  "status",
  "workCenterId",
  ...dispatchTimeFields
]);

/**
 * Set one field on one or more maintenance dispatches.
 *
 * @remarks
 * Refused when any of the dispatches is Completed or Cancelled. An empty
 * value clears the field. Setting the status to In Progress stamps the actual
 * start, and to Completed the actual end. A change to the status, work center
 * or timing of a dispatch that takes its work center offline moves the
 * downtime window, so the scheduler is told for each such work center.
 * Completing closes every open timecard, so their labor is posted; when that
 * fails, the field is still set and `warning` says so.
 *
 * @mcp
 */
export const updateMaintenanceDispatchField = defineServiceFn({
  input: z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum([...dispatchValueFields, ...dispatchTimeFields]),
    value: z.string().nullish()
  }),
  permission: { update: "resources" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const dispatches = await client
      .from("maintenanceDispatch")
      .select("id, status, takesWorkCenterOffline, workCenterId")
      .in("id", ids)
      .eq("companyId", companyId);
    if (dispatches.error) {
      return ctx.error(
        "internal",
        "Failed to update maintenance dispatch(es)",
        dispatches.error
      );
    }
    if (dispatches.data.some((d) => isMaintenanceDispatchLocked(d.status))) {
      return ctx.error("rule", DISPATCH_LOCKED);
    }

    const now = datetime.timestamp();
    const isTime = (dispatchTimeFields as readonly string[]).includes(field);
    const update: Record<string, string | null> = {
      [field]: isTime
        ? value
          ? new Date(value).toISOString()
          : null
        : value || null,
      updatedBy: ctx.auditUserId,
      updatedAt: now
    };
    if (field === "status" && value === "In Progress") {
      update.actualStartTime = now;
    } else if (field === "status" && value === "Completed") {
      update.actualEndTime = now;
    }

    const updated = await client
      .from("maintenanceDispatch")
      .update(unchecked(update))
      .in("id", ids)
      .eq("companyId", companyId);
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update maintenance dispatch(es)",
        updated.error
      );
    }

    if (scheduleAffectingFields.has(field)) {
      const workCenterIds = new Set(
        dispatches.data.flatMap((d) =>
          d.takesWorkCenterOffline && d.workCenterId ? [d.workCenterId] : []
        )
      );
      for (const workCenterId of workCenterIds) {
        await notifyScheduleInputsChanged(
          companyId,
          "work-center",
          "Machine downtime changed",
          workCenterId
        );
      }
    }

    let warning: string | null = null;
    if (field === "status" && value === "Completed") {
      const postingError = await postMaintenanceLabor(
        ctx,
        dispatches.data.map((d) => d.id)
      );
      if (postingError) {
        warning = `Updated, but labor cost did not post: ${postingError}`;
      }
    }
    return { ids, warning };
  }
});

/**
 * Set a maintenance dispatch's status.
 *
 * @remarks
 * Any status, so a Completed or Cancelled dispatch can be reopened. In
 * Progress stamps the actual start; Completed and Cancelled clear the
 * assignee. Completing closes every open timecard, so their labor is posted;
 * when that fails, the status is still set and `warning` says so.
 *
 * @mcp
 */
export const setMaintenanceDispatchStatus = defineServiceFn({
  input: z.object({
    dispatchId: z.string(),
    status: z.enum(maintenanceDispatchStatus)
  }),
  permission: { update: "resources" },

  async run(ctx, { dispatchId, status }) {
    const update = await ctx.asCaller.supabase
      .from("maintenanceDispatch")
      .update({
        status,
        assignee: ["Completed", "Cancelled"].includes(status)
          ? null
          : undefined,
        actualStartTime:
          status === "In Progress" ? datetime.timestamp() : undefined,
        updatedBy: ctx.auditUserId
      })
      .eq("id", dispatchId)
      .eq("companyId", ctx.company.id)
      .select("id");
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update dispatch status",
        update.error
      );
    }
    if (update.data.length === 0) {
      return ctx.error("notFound", "Dispatch not found");
    }

    const postingError =
      status === "Completed"
        ? await postMaintenanceLabor(ctx, [dispatchId])
        : null;
    return {
      id: dispatchId,
      warning: postingError
        ? "Updated dispatch status, but its labor cost did not post"
        : null
    };
  }
});

/**
 * Add a timecard to a maintenance dispatch.
 *
 * @remarks
 * Refused when the dispatch is Completed or Cancelled. Then the dispatch's
 * labor is posted; when that fails, the timecard is still added and `warning`
 * says so.
 *
 * @mcp
 */
export const createMaintenanceEvent = defineServiceFn({
  input: maintenanceDispatchEventValidator,
  permission: { update: "resources" },

  async run(ctx, { id: _id, maintenanceDispatchId, endTime, notes, ...event }) {
    const dispatch = await editableDispatch(ctx, maintenanceDispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const insert = await upsertMaintenanceDispatchEvent(ctx.asCaller.supabase, {
      ...event,
      maintenanceDispatchId,
      endTime: endTime ?? undefined,
      notes: notes ?? undefined,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (insert.error || !insert.data) {
      return ctx.error("internal", "Failed to add timecard", insert.error);
    }

    const postingError = await postMaintenanceLabor(ctx, [
      maintenanceDispatchId
    ]);
    return {
      id: insert.data.id,
      warning: postingError
        ? "Timecard added, but its labor cost did not post"
        : null
    };
  }
});

/**
 * Update a timecard of a maintenance dispatch.
 *
 * @remarks
 * The timecard must be the dispatch's, and the dispatch not Completed or
 * Cancelled. Then the dispatch's labor is posted again; when that fails, the
 * timecard is still updated and `warning` says so.
 *
 * @mcp
 */
export const updateMaintenanceEvent = defineServiceFn({
  input: maintenanceDispatchEventValidator.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, maintenanceDispatchId, ...event }) {
    const dispatch = await editableDispatch(ctx, maintenanceDispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const update = await ctx.asCaller.supabase
      .from("maintenanceDispatchEvent")
      .update({
        employeeId: event.employeeId,
        workCenterId: event.workCenterId,
        startTime: event.startTime,
        endTime: event.endTime ?? null,
        notes: event.notes ?? null,
        updatedBy: ctx.auditUserId
      })
      .eq("id", id)
      .eq("maintenanceDispatchId", maintenanceDispatchId)
      .eq("companyId", ctx.company.id)
      .select("id");
    if (update.error) {
      return ctx.error("internal", "Failed to update timecard", update.error);
    }
    if (update.data.length === 0) {
      return ctx.error("notFound", "Timecard not found");
    }

    const postingError = await postMaintenanceLabor(ctx, [
      maintenanceDispatchId
    ]);
    return {
      id,
      warning: postingError
        ? "Timecard updated, but its labor cost did not post"
        : null
    };
  }
});

/**
 * Remove a timecard from a maintenance dispatch.
 *
 * @remarks
 * Refused when the dispatch is Completed or Cancelled. Then the dispatch's
 * labor is posted again, which reverses the timecard's cost; when that fails,
 * the timecard is still removed and `warning` says so.
 *
 * @mcp destructive
 */
export const deleteMaintenanceEvent = defineServiceFn({
  input: z.object({ dispatchId: z.string(), eventId: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { dispatchId, eventId }) {
    const dispatch = await editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const removed = await ctx.asCaller.supabase
      .from("maintenanceDispatchEvent")
      .delete()
      .eq("id", eventId)
      .eq("maintenanceDispatchId", dispatchId)
      .eq("companyId", ctx.company.id);
    if (removed.error) {
      return ctx.error("internal", "Failed to delete timecard", removed.error);
    }

    const postingError = await postMaintenanceLabor(ctx, [dispatchId]);
    return {
      id: eventId,
      warning: postingError
        ? "Timecard removed, but its labor cost was not reversed"
        : null
    };
  }
});

/**
 * Start the caller's timer on a maintenance dispatch.
 *
 * @remarks
 * Opens a timecard for the caller on the dispatch's work center, starting
 * now. Refused when the dispatch is Completed or Cancelled, or has no work
 * center.
 *
 * @mcp
 */
export const startMaintenanceEvent = defineServiceFn({
  input: z.object({ dispatchId: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { dispatchId }) {
    const dispatch = await editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;
    if (!dispatch.workCenterId) {
      return ctx.error("rule", "The dispatch has no work center");
    }

    const insert = await ctx.asCaller.supabase
      .from("maintenanceDispatchEvent")
      .insert({
        maintenanceDispatchId: dispatchId,
        employeeId: ctx.auditUserId,
        workCenterId: dispatch.workCenterId,
        startTime: datetime.timestamp(),
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      })
      .select("id")
      .single();
    if (insert.error) {
      return ctx.error("internal", "Failed to start event", insert.error);
    }
    return { id: insert.data.id };
  }
});

/**
 * Stop a running timer on a maintenance dispatch.
 *
 * @remarks
 * Ends the timecard now. Refused when the dispatch is Completed or
 * Cancelled. Then the dispatch's labor is posted; when that fails, the timer
 * is still stopped and `warning` says so.
 *
 * @mcp
 */
export const stopMaintenanceEvent = defineServiceFn({
  input: z.object({ dispatchId: z.string(), eventId: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { dispatchId, eventId }) {
    const dispatch = await editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const update = await ctx.asCaller.supabase
      .from("maintenanceDispatchEvent")
      .update({ endTime: datetime.timestamp(), updatedBy: ctx.auditUserId })
      .eq("id", eventId)
      .eq("maintenanceDispatchId", dispatchId)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", "Failed to stop event", update.error);
    }

    const postingError = await postMaintenanceLabor(ctx, [dispatchId]);
    return {
      id: eventId,
      warning: postingError
        ? "Event stopped, but its labor cost did not post"
        : null
    };
  }
});

/**
 * Add a spare part to a maintenance dispatch and issue it from stock.
 *
 * @remarks
 * Refused when the dispatch is Completed or Cancelled. A serial or batch part
 * names the tracked entities it takes in `children`; any other part takes
 * `quantity` from inventory at the dispatch's location. The quantity must be
 * more than 0. The stock leaves inventory through the `issue` server
 * function.
 *
 * @mcp
 */
export const issueMaintenancePart = defineServiceFn({
  input: z.object({
    dispatchId: z.string(),
    itemId: z.string().min(1),
    unitOfMeasureCode: z.string().min(1),
    quantity: z.number().optional(),
    children: z
      .array(z.object({ trackedEntityId: z.string(), quantity: z.number() }))
      .optional()
  }),
  permission: { update: "resources" },

  async run(
    ctx,
    { dispatchId, itemId, unitOfMeasureCode, quantity, children }
  ) {
    const dispatch = await editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const total = children
      ? children.reduce((sum, child) => sum + child.quantity, 0)
      : (quantity ?? 0);
    if (total <= 0) {
      return ctx.error("validation", "Quantity must be greater than 0");
    }

    const fns = serverFns.system({
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    const tracked = !!children && children.length > 0;
    const issued = tracked
      ? await fns.invoke("issue", {
          type: "maintenanceDispatchTrackedEntities",
          maintenanceDispatchId: dispatchId,
          itemId,
          unitOfMeasureCode,
          children
        })
      : await fns.invoke("issue", {
          type: "maintenanceDispatchInventory",
          maintenanceDispatchId: dispatchId,
          itemId,
          unitOfMeasureCode,
          quantity: total
        });
    if (issued.error) {
      return ctx.error(
        "internal",
        tracked
          ? "Failed to issue tracked items"
          : "Failed to issue from inventory",
        issued.error
      );
    }
    return { dispatchId, itemId };
  }
});

/**
 * Remove a spare part from a maintenance dispatch and return it to stock.
 *
 * @remarks
 * The part must be the dispatch's, and the dispatch not Completed or
 * Cancelled. The stock returns to inventory through the `issue` server
 * function.
 *
 * @mcp destructive
 */
export const unissueMaintenancePart = defineServiceFn({
  input: z.object({
    dispatchId: z.string(),
    maintenanceDispatchItemId: z.string()
  }),
  permission: { delete: "resources" },

  async run(ctx, { dispatchId, maintenanceDispatchItemId }) {
    const dispatch = await editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const item = await ctx.asCaller.supabase
      .from("maintenanceDispatchItem")
      .select("id")
      .eq("id", maintenanceDispatchItemId)
      .eq("maintenanceDispatchId", dispatchId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (item.error) {
      return ctx.error("internal", "Failed to remove item", item.error);
    }
    if (!item.data) return ctx.error("notFound", "Item not found");

    const returned = await serverFns
      .system({
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
      .invoke("issue", {
        type: "maintenanceDispatchUnissue",
        maintenanceDispatchItemId
      });
    if (returned.error) {
      return ctx.error("internal", "Failed to remove item", returned.error);
    }
    return { id: maintenanceDispatchItemId };
  }
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * Submit a suggestion.
 *
 * @remarks
 * Anonymous unless `attributed`. An attachment counts only when it is under
 * the company's `suggestions/` folder. With `sendToCarbon` the suggestion is
 * also posted to Carbon's Slack. The company's suggestion group is notified.
 * Any member of the company may submit, so this is not published.
 */
export const createSuggestion = defineServiceFn({
  input: z.object({
    suggestion: z.string().min(1),
    emoji: z.string(),
    path: z.string(),
    attachmentPath: z.string().optional(),
    attributed: z.boolean(),
    sendToCarbon: z.boolean()
  }),
  permission: {},

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const userId = input.attributed ? ctx.auditUserId : null;
    const attachmentPath =
      input.attachmentPath?.startsWith(`${companyId}/suggestions/`) &&
      !isUnsafeStoragePath(input.attachmentPath)
        ? input.attachmentPath
        : null;
    const serviceRole = ctx.asSystem.supabase;

    const insert = await serviceRole
      .from("suggestion")
      .insert([
        {
          suggestion: input.suggestion,
          emoji: input.emoji,
          path: input.path,
          attachmentPath,
          userId,
          companyId
        }
      ])
      .select("id")
      .single();
    if (insert.error) {
      return ctx.error("internal", "Failed to submit suggestion", insert.error);
    }

    const company = await getCompany(serviceRole, companyId);
    if (input.sendToCarbon) {
      await postSuggestionToCarbonSlack(serviceRole, {
        companyId,
        companyName: company.data?.name,
        suggestion: input.suggestion,
        emoji: input.emoji,
        path: input.path,
        userId,
        attachmentPath
      });
    }

    if (!company.error && company.data?.suggestionNotificationGroup?.length) {
      try {
        await trigger("notify", {
          companyId,
          documentId: insert.data.id,
          event: NotificationEvent.SuggestionResponse,
          recipient: {
            type: "group",
            groupIds: company.data.suggestionNotificationGroup
          },
          from: userId ?? ctx.auditUserId
        });
      } catch (err) {
        logger.error("Failed to trigger suggestion notification", {
          companyId,
          error: err
        });
      }
    }
    return { id: insert.data.id };
  }
});

// ---------------------------------------------------------------------------
// Trainings
// ---------------------------------------------------------------------------

const trainingFields = [
  "content",
  "name",
  "status",
  "type",
  "frequency",
  "estimatedDuration",
  "description",
  "grantsAbilityId",
  "guidePath"
] as const;

/**
 * Set one field on one or more trainings.
 *
 * @remarks
 * An empty `grantsAbilityId` clears it. `guidePath` is the PDF that replaces
 * the written content: it takes one training, must be a key under that
 * training's folder (empty clears it), and changes only while the training is
 * Draft.
 *
 * @mcp
 */
export const updateTrainingField = defineServiceFn({
  input: z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum(trainingFields),
    value: z.string()
  }),
  permission: { update: "people" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };

    if (field === "guidePath") {
      const [trainingId] = ids;
      if (
        ids.length !== 1 ||
        !trainingId ||
        (value !== "" &&
          !isValidTrainingGuideKey(
            value,
            trainingGuideKeyPrefix(companyId, trainingId)
          ))
      ) {
        return ctx.error("validation", "Invalid guide file");
      }
      // The guide is the training's content, so it changes only while Draft.
      // Filtering the update on status makes the check and the write one step.
      const updated = await client
        .from("training")
        .update({ guidePath: value || null, ...audit })
        .eq("id", trainingId)
        .eq("companyId", companyId)
        .eq("status", "Draft")
        .select("id");
      if (updated.error) {
        return ctx.error(
          "internal",
          "Failed to update training",
          updated.error
        );
      }
      if (updated.data.length === 0) {
        return ctx.error(
          "rule",
          "The guide can only change while the training is Draft"
        );
      }
      return { ids };
    }

    const updated = await client
      .from("training")
      .update(
        unchecked({
          [field]: field === "grantsAbilityId" ? value || null : value,
          ...audit
        })
      )
      .in("id", ids)
      .eq("companyId", companyId);
    if (updated.error) {
      return ctx.error("internal", "Failed to update training", updated.error);
    }
    return { ids };
  }
});

/** Tell an internal assignment's groups they have a training to take. */
async function notifyTrainingAssignment(
  ctx: ServiceContext,
  assignmentId: string,
  groupIds: string[]
) {
  try {
    await trigger("notify", {
      companyId: ctx.company.id,
      documentId: assignmentId,
      event: NotificationEvent.TrainingAssignment,
      recipient: { type: "group", groupIds },
      from: ctx.auditUserId
    });
  } catch (err) {
    logger.error("Failed to send training assignment notifications", {
      companyId: ctx.company.id,
      assignmentId,
      error: err
    });
  }
}

/**
 * Assign a training to groups.
 *
 * @remarks
 * An internal assignment names a training of this company; an external one
 * (`isExternal`) has only a name, because it happens in an outside system. A
 * training is assigned once: a second assignment would double every employee
 * in the status views, so edit the existing one instead. The groups of an
 * internal assignment are notified; an outside system notifies for an
 * external one.
 *
 * @mcp
 */
export const createTrainingAssignment = defineServiceFn({
  input: trainingAssignmentValidator,
  permission: { create: "resources" },

  async run(ctx, { isExternal, trainingId, name, groupIds }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    if (!isExternal && trainingId) {
      const refused = await refuseUnlessOwned(ctx, "training", {
        id: trainingId
      });
      if (refused) return refused;
      const existing = await getTrainingAssignments(
        client,
        companyId,
        trainingId
      );
      if (existing.error) {
        return ctx.error(
          "internal",
          "Failed to create assignment",
          existing.error
        );
      }
      if (existing.data.length > 0) {
        return ctx.error(
          "rule",
          "This training is already assigned. Edit the existing assignment to add more groups or people."
        );
      }
    }

    const insert = await upsertTrainingAssignment(client, {
      trainingId: isExternal ? null : trainingId,
      name: isExternal ? name : null,
      groupIds,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (insert.error) {
      return ctx.error("internal", "Failed to create assignment", insert.error);
    }

    if (!isExternal) {
      await notifyTrainingAssignment(ctx, insert.data.id, groupIds);
    }
    return { id: insert.data.id };
  }
});

/**
 * Change a training assignment's groups, or an external one's name.
 *
 * @remarks
 * Internal or external is fixed at creation and read from the stored
 * assignment, never the input. The groups of an internal assignment are
 * notified.
 *
 * @mcp
 */
export const updateTrainingAssignment = defineServiceFn({
  input: trainingAssignmentValidator.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, name, groupIds }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const stored = await getTrainingAssignment(client, id);
    if (stored.error || stored.data.companyId !== companyId) {
      return ctx.error(
        "notFound",
        "Training assignment not found",
        stored.error
      );
    }
    const isExternal = stored.data.trainingId === null;

    const update = await upsertTrainingAssignment(client, {
      id,
      name: isExternal ? name : null,
      groupIds,
      companyId,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update assignment", update.error);
    }

    if (!isExternal) await notifyTrainingAssignment(ctx, id, groupIds);
    return { id };
  }
});

/**
 * Mark a training assignment complete for an employee.
 *
 * @remarks
 * Only an employee in the assignment's groups can complete it: a completion
 * can grant an ability, which gates scheduling. An internal training must be
 * Active. An external assignment may carry a certificate (PDF, PNG or JPG, 10
 * MB). A second completion in the same period counts as already recorded. A
 * granted ability restamps the scheduler. Takes a file, so it is not
 * published.
 */
export const completeTrainingAssignment = defineServiceFn({
  input: z.object({
    trainingAssignmentId: z.string().min(1),
    employeeId: z.string().min(1),
    certificate: z.instanceof(File).optional()
  }),
  permission: { update: "resources" },

  async run(ctx, { trainingAssignmentId, employeeId, certificate }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const assignment = await getTrainingAssignment(
      client,
      trainingAssignmentId
    );
    if (assignment.error || assignment.data.companyId !== companyId) {
      return ctx.error(
        "notFound",
        "Training assignment not found",
        assignment.error
      );
    }

    const recipients = await client.rpc("users_for_groups", {
      groups: assignment.data.groupIds ?? []
    });
    const recipientIds = (recipients.data ?? []) as string[];
    if (recipients.error || !recipientIds.includes(employeeId)) {
      logger.error("Employee is not assigned this training", {
        companyId,
        trainingAssignmentId,
        employeeId,
        error: recipients.error
      });
      return ctx.error("rule", "This employee is not assigned this training");
    }

    const recorded = await recordTrainingCompletion(client, {
      companyId,
      trainingAssignmentId,
      employeeId,
      completedBy: ctx.auditUserId,
      assignment: assignment.data,
      certificate
    });
    if (recorded.error !== null) {
      return ctx.error(
        recorded.status === 400 ? "validation" : "internal",
        recorded.error
      );
    }
    return { trainingAssignmentId, employeeId };
  }
});

/**
 * Remove a wrong training completion.
 *
 * @remarks
 * Also deletes its certificate file, which holds employee data nothing points
 * at any more. The employee keeps any ability the completion granted: the
 * grant only adds, and the person may hold the ability for another reason.
 *
 * @mcp destructive
 */
export const uncompleteTrainingAssignment = defineServiceFn({
  input: z.object({ completionId: zfd.numeric(z.number().int().positive()) }),
  permission: { delete: "resources" },

  async run(ctx, { completionId }) {
    const companyId = ctx.company.id;
    const removed = await deleteTrainingCompletion(
      ctx.asCaller.supabase,
      completionId,
      companyId
    );
    if (removed.error) {
      return ctx.error(
        "internal",
        "Failed to remove the completion",
        removed.error
      );
    }

    const certificatePaths = (removed.data ?? []).flatMap((row) =>
      row.certificatePath ? [row.certificatePath] : []
    );
    if (certificatePaths.length > 0) {
      const files = await storage(ctx.asCaller.supabase)
        .company(companyId)
        .remove(certificatePaths);
      if (files.error) {
        logger.error("Failed to remove training certificate", {
          companyId,
          completionId,
          error: files.error
        });
      }
    }
    return { completionId };
  }
});
