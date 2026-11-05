// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import type { Json } from "@carbon/database";
import { isUnsafeStoragePath, storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { postSuggestionToCarbonSlack } from "@carbon/lib/slack.server";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { datetime, requireAffected, unchecked } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { notifyScheduleInputsChanged } from "~/modules/production/production.service";
import { getCompany } from "~/modules/settings/settings.service";
import { optionalTiptapDoc } from "~/modules/shared/shared.models";
import {
  invalidateLocationTimeZone,
  refuseUnlessOwned
} from "~/modules/shared/shared.service";
import * as inventoryPostings from "../inventory/inventory.service";
import { invokePosting } from "../shared/shared.service";
import {
  abilityValidator,
  employeeAbilityCellValidator,
  getYouTubeVideoId,
  isMaintenanceDispatchLocked,
  isValidTrainingGuideKey,
  locationValidator,
  maintenanceDispatchEventValidator,
  maintenanceDispatchStatus,
  maintenanceDispatchValidator,
  maintenanceScheduleValidator,
  processValidator,
  trainingAssignmentValidator,
  trainingGuideKeyPrefix,
  workCenterValidator,
  youTubeWatchUrl
} from "./resources.models";
import * as service from "./resources.service";

const logger = getLogger("erp", "resources");

/** The `custom-*` fields of a form, by field id (`setCustomFields`). */
const customFieldsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export const createAbility = defineServiceFn({
  publish: true,
  title: "Create the ability for a process",
  description: `An ability IS a process's qualification: the process must be this
company's, and creating its ability turns \`requiresAbility\` on for it. The
ability is found or created (\`ensureProcessAbility\`), so a process never
gets two. The scheduler is told, because the gate changes the operator pool
of every job on the process.`,
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

    const ability = await service.ensureProcessAbility(client, {
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

export const deactivateAbility = defineServiceFn({
  publish: true,
  title: "Deactivate an ability",
  description: `A soft delete: requirement tables still reference the ability. Deactivating
it un-gates any process that required it, so the scheduler is told.`,
  input: z.object({ id: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { id }) {
    const deactivated = await service.deleteAbility(
      ctx.asCaller.supabase,
      id,
      false
    );
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
export const addEmployeeAbility = defineServiceFn({
  publish: true,
  title: "Qualify an employee for an ability",
  description: `The ability must be this company's. Without an explicit \`expiresAt\`, the
expiry is the last training date plus the ability's recertification period
(none when the ability never expires). An employee already qualified keeps
one row, with these dates. The scheduler is told: the operator pool of the
ability's process changes.`,
  input: employeeAbilityCellValidator,
  permission: { update: "resources" },

  async run(ctx, input) {
    return service.saveEmployeeAbility(ctx, input, {
      failure: "Failed to add employee to ability",
      reason: "Operator qualification added"
    });
  }
});

export const updateEmployeeAbility = defineServiceFn({
  publish: true,
  title: "Update an employee's qualification for an ability",
  description: `The same write as \`addEmployeeAbility\`: the ability must be this company's,
and a blank \`expiresAt\` is worked out from the last training date and the
ability's recertification period. The scheduler is told.`,
  input: employeeAbilityCellValidator,
  permission: { update: "resources" },

  async run(ctx, input) {
    return service.saveEmployeeAbility(ctx, input, {
      failure: "Failed to update employee ability",
      reason: "Operator qualification updated"
    });
  }
});

export const removeEmployeeAbility = defineServiceFn({
  publish: "destructive",
  title: "Remove an employee from an ability",
  description: `A hard delete of the qualification row, which must belong to \`abilityId\`.
The employee can be added again later. The scheduler is told.`,
  input: z.object({ abilityId: z.string(), employeeAbilityId: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { abilityId, employeeAbilityId }) {
    const removed = await requireAffected(
      ctx.asCaller.supabase
        .from("employeeAbility")
        .delete()
        .eq("id", employeeAbilityId)
        .eq("abilityId", abilityId)
        .eq("companyId", ctx.company.id)
        .select("id")
    );
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

export const createLocation = defineServiceFn({
  publish: true,
  title: "Create a location",
  input: locationValidator.safeExtend({ customFields: customFieldsInput }),
  permission: { create: "resources" },

  async run(ctx, { id: _id, ...location }) {
    const insert = await service.upsertLocation(ctx.asCaller.supabase, {
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

export const updateLocation = defineServiceFn({
  publish: true,
  title: "Update a location",
  description: `The location's timezone may change, so its cached timezone is dropped, and
a new timezone re-plans the schedule: shifts are local times.`,
  input: locationValidator.safeExtend({
    id: z.string(),
    customFields: customFieldsInput
  }),
  // The route gated on create; the write runs under the update policy.
  permission: { create: "resources", update: "resources" },

  async run(ctx, { id, ...location }) {
    const previous = await ctx.asCaller.supabase
      .from("location")
      .select("timezone")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (previous.error) {
      return ctx.error(
        "internal",
        "Failed to update location.",
        previous.error
      );
    }
    const update = await service.upsertLocation(ctx.asCaller.supabase, {
      id,
      ...location,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update location.", update.error);
    }

    await invalidateLocationTimeZone(id, ctx.company.id);
    if (
      previous.data !== null &&
      previous.data.timezone !== location.timezone
    ) {
      await notifyScheduleInputsChanged(
        ctx.company.id,
        "location",
        "Location timezone changed",
        id
      );
    }
    return { id };
  }
});

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

const processInput = processValidator.safeExtend({
  customFields: customFieldsInput
});

export const createProcess = defineServiceFn({
  publish: true,
  title: "Create a process",
  description: `Saves the process and links its work centers. When \`requiresAbility\` is on,
the process's ability is created; if that fails, \`requiresAbility\` is turned
off again, so no process gates scheduling on a qualification nobody can
hold.`,
  input: processInput,
  permission: { create: "resources" },

  async run(ctx, { id: _id, ...process }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const taken = await service.findProcessNamed(
      client,
      companyId,
      process.name
    );
    if (taken.error) {
      return ctx.error("internal", "Failed to create process.", taken.error);
    }
    if (taken.data) {
      return ctx.error(
        "conflict",
        service.processNameTakenMessage(process.name, taken.data.active)
      );
    }
    const insert = await service.insertProcess(client, {
      ...process,
      companyId,
      createdBy: ctx.auditUserId
    });
    // 23505: another request created the same name since the check above.
    if (insert.error?.code === "23505") {
      return ctx.error(
        "conflict",
        service.processNameTakenMessage(process.name)
      );
    }
    if (insert.error || !insert.data?.id) {
      return ctx.error("internal", "Failed to create process.", insert.error);
    }
    const id = insert.data.id;

    if (process.requiresAbility) {
      const ability = await service.ensureProcessAbility(client, {
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

export const updateProcess = defineServiceFn({
  publish: true,
  title: "Update a process",
  description: `Saves the process and replaces its work centers. Turning \`requiresAbility\`
on creates the process's ability; if that fails, \`requiresAbility\` goes back
to what it was. When \`requiresAbility\` changes, the scheduler is told, by
the process's ability when there is one, else company-wide.`,
  input: processInput.safeExtend({ id: z.string() }),
  // The route gated on create and wrote under the caller's policies: the
  // process update, and the delete and insert of its work centers, which
  // now run on the system connection.
  permission: { create: "resources", update: "resources", delete: "resources" },

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

    const taken = await service.findProcessNamed(
      client,
      companyId,
      process.name,
      id
    );
    if (taken.error) {
      return ctx.error("internal", "Failed to update process.", taken.error);
    }
    if (taken.data) {
      return ctx.error(
        "conflict",
        service.processNameTakenMessage(process.name, taken.data.active)
      );
    }

    const update = await service.updateProcess(ctx.asSystem.pg, {
      id,
      ...process,
      companyId,
      updatedBy: ctx.auditUserId
    });
    // 23505: another request took the name since the check above.
    if (update.code === "23505") {
      return ctx.error(
        "conflict",
        service.processNameTakenMessage(process.name)
      );
    }
    if (update.error) {
      return ctx.error("internal", "Failed to update process.", update.error);
    }

    let abilityId: string | undefined;
    if (process.requiresAbility) {
      const ability = await service.ensureProcessAbility(client, {
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

export const createWorkCenter = defineServiceFn({
  publish: true,
  title: "Create a work center",
  description: `Saves the work center with its processes and shifts, then tells the
scheduler: its hours are new capacity.`,
  input: workCenterInput,
  // The route gated on update; the inserts run under the create policy.
  permission: { create: "resources", update: "resources" },

  async run(ctx, { id: _id, ...workCenter }) {
    const insert = await service.upsertWorkCenter(ctx.asCaller.supabase, {
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

export const updateWorkCenter = defineServiceFn({
  publish: true,
  title: "Update a work center",
  description: `Saves the work center and replaces its processes and shifts, then tells
the scheduler: its hours may have changed.`,
  input: workCenterInput.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, ...workCenter }) {
    const update = await service.upsertWorkCenter(ctx.asCaller.supabase, {
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

export const reactivateWorkCenter = defineServiceFn({
  publish: true,
  title: "Reactivate a work center",
  description: "Its hours return to the schedule, so the scheduler is told.",
  input: z.object({ id: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { id }) {
    const activated = await service.activateWorkCenter(
      ctx.asCaller.supabase,
      id
    );
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

export const deactivateWorkCenter = defineServiceFn({
  publish: true,
  title: "Deactivate a work center",
  description: `A soft delete (\`active: false\`): job operations and schedules still
reference it. Its hours leave the schedule, so the scheduler is told.`,
  input: z.object({ id: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { id }) {
    const deactivated = await service.deactivateWorkCenter(
      ctx.asCaller.supabase,
      id
    );
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

export const deleteWorkCenter = defineServiceFn({
  publish: "destructive",
  title: "Delete a work center",
  description: `Refused while anything references it: operations on a method, quote or
job, production events, maintenance, lineside storage units, fixed assets
or machine devices. Deactivate it instead. Its process links, shifts and
rule assignments go with it, and the scheduler is told.`,
  input: z.object({ id: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { id }) {
    const result = await ctx.transaction(async (tx) => {
      const deleted = await service.deleteWorkCenter(tx.asSystem.pg, {
        id,
        companyId: ctx.company.id
      });
      if (!deleted.found) return ctx.error("notFound", "Work center not found");
      if (!deleted.deleted) {
        return ctx.error(
          "conflict",
          service.referencedRefusal("work center", deleted.references)
        );
      }
      return { id };
    });
    if (result.error) return result.error;

    await notifyScheduleInputsChanged(
      ctx.company.id,
      "work-center",
      "Work center deleted",
      id
    );
    return { id };
  }
});

/**
 * What references a work center: the rows that block deleting it.
 */
export const getWorkCenterReferences = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { view: "resources" },

  async run(ctx, { id }) {
    return service.getWorkCenterReferences(ctx.asSystem.pg, {
      id,
      companyId: ctx.company.id
    });
  }
});

// ---------------------------------------------------------------------------
// Maintenance schedules
// ---------------------------------------------------------------------------

export const createMaintenanceSchedule = defineServiceFn({
  publish: true,
  title: "Create a preventive maintenance schedule",
  description: `Then generates its dispatches and next due date now, so it shows on the
maintenance displays without waiting for the nightly run.`,
  input: maintenanceScheduleValidator,
  permission: { create: "resources" },

  async run(ctx, { id: _id, ...schedule }) {
    const insert = await service.upsertMaintenanceSchedule(
      ctx.asCaller.supabase,
      {
        ...schedule,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
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

export const updateMaintenanceSchedule = defineServiceFn({
  publish: true,
  title: "Update a preventive maintenance schedule",
  description: `Then generates its dispatches again, so a change of frequency, active or
day of week shows on the maintenance displays without waiting for the
nightly run.`,
  input: maintenanceScheduleValidator.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, ...schedule }) {
    const update = await service.upsertMaintenanceSchedule(
      ctx.asCaller.supabase,
      {
        id,
        ...schedule,
        updatedBy: ctx.auditUserId
      }
    );
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
export const createMaintenanceDispatch = defineServiceFn({
  publish: true,
  title: "Create a maintenance dispatch",
  description: `Takes the next dispatch number. \`content\` is the notes document as JSON. A
dispatch that takes its work center offline removes hours from the
schedule, so the scheduler is told.`,
  input: maintenanceDispatchValidator.extend({
    content: optionalTiptapDoc
  }),
  permission: { create: "resources" },

  async run(ctx, input) {
    const content: Json | undefined = input.content;

    const result = await service.insertMaintenanceDispatch(
      ctx.asCaller.supabase,
      {
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
      }
    );
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

export const updateMaintenanceDispatchField = defineServiceFn({
  publish: true,
  title: "Set one field on one or more maintenance dispatches",
  description: `Refused when any of the dispatches is Completed or Cancelled. An empty
value clears the field. Setting the status to In Progress stamps the actual
start, and to Completed the actual end. A change to the status, work center
or timing of a dispatch that takes its work center offline moves the
downtime window, so the scheduler is told for each such work center.
Completing closes every open timecard, so their labor is posted; when that
fails, the field is still set and \`warning\` says so.`,
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
      return ctx.error("rule", service.DISPATCH_LOCKED);
    }

    const now = datetime.timestamp();
    const isTime = (dispatchTimeFields as readonly string[]).includes(field);
    let fieldValue = value || null;
    if (isTime && fieldValue) {
      try {
        fieldValue = parseAbsolute(fieldValue, "UTC").toAbsoluteString();
      } catch {
        return ctx.error(
          "validation",
          "A time must be an ISO 8601 instant with an offset"
        );
      }
    }
    const update: Record<string, string | null> = {
      [field]: fieldValue,
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
      const postingError = await service.postMaintenanceLabor(
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

export const setMaintenanceDispatchStatus = defineServiceFn({
  publish: true,
  title: "Set a maintenance dispatch's status",
  description: `Any status, so a Completed or Cancelled dispatch can be reopened. In
Progress stamps the actual start; Completed and Cancelled clear the
assignee. Completing closes every open timecard, so their labor is posted;
when that fails, the status is still set and \`warning\` says so.`,
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
        ? await service.postMaintenanceLabor(ctx, [dispatchId])
        : null;
    return {
      id: dispatchId,
      warning: postingError
        ? "Updated dispatch status, but its labor cost did not post"
        : null
    };
  }
});

export const createMaintenanceEvent = defineServiceFn({
  publish: true,
  title: "Add a timecard to a maintenance dispatch",
  description: `Refused when the dispatch is Completed or Cancelled. Then the dispatch's
labor is posted; when that fails, the timecard is still added and \`warning\`
says so.`,
  input: maintenanceDispatchEventValidator,
  permission: { update: "resources" },

  async run(ctx, { id: _id, maintenanceDispatchId, endTime, notes, ...event }) {
    const dispatch = await service.editableDispatch(ctx, maintenanceDispatchId);
    if (dispatch instanceof CarbonError) return dispatch;
    const refused = await service.refuseForeignTimecard(ctx, event);
    if (refused) return refused;

    const insert = await service.upsertMaintenanceDispatchEvent(
      ctx.asCaller.supabase,
      {
        ...event,
        maintenanceDispatchId,
        endTime: endTime ?? undefined,
        notes: notes ?? undefined,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    if (insert.error || !insert.data) {
      return ctx.error("internal", "Failed to add timecard", insert.error);
    }

    const postingError = await service.postMaintenanceLabor(ctx, [
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

export const updateMaintenanceEvent = defineServiceFn({
  publish: true,
  title: "Update a timecard of a maintenance dispatch",
  description: `The timecard must be the dispatch's, and the dispatch not Completed or
Cancelled. Then the dispatch's labor is posted again; when that fails, the
timecard is still updated and \`warning\` says so.`,
  input: maintenanceDispatchEventValidator.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, maintenanceDispatchId, ...event }) {
    const dispatch = await service.editableDispatch(ctx, maintenanceDispatchId);
    if (dispatch instanceof CarbonError) return dispatch;
    const refused = await service.refuseForeignTimecard(ctx, event);
    if (refused) return refused;

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

    const postingError = await service.postMaintenanceLabor(ctx, [
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

export const deleteMaintenanceEvent = defineServiceFn({
  publish: "destructive",
  title: "Remove a timecard from a maintenance dispatch",
  description: `Refused when the dispatch is Completed or Cancelled. Then the dispatch's
labor is posted again, which reverses the timecard's cost; when that fails,
the timecard is still removed and \`warning\` says so.`,
  input: z.object({ dispatchId: z.string(), eventId: z.string() }),
  permission: { delete: "resources" },

  async run(ctx, { dispatchId, eventId }) {
    const dispatch = await service.editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const removed = await requireAffected(
      ctx.asCaller.supabase
        .from("maintenanceDispatchEvent")
        .delete()
        .eq("id", eventId)
        .eq("maintenanceDispatchId", dispatchId)
        .eq("companyId", ctx.company.id)
        .select("id")
    );
    if (removed.error) {
      return ctx.error("internal", "Failed to delete timecard", removed.error);
    }

    const postingError = await service.postMaintenanceLabor(ctx, [dispatchId]);
    return {
      id: eventId,
      warning: postingError
        ? "Timecard removed, but its labor cost was not reversed"
        : null
    };
  }
});

export const startMaintenanceEvent = defineServiceFn({
  publish: true,
  title: "Start the caller's timer on a maintenance dispatch",
  description: `Opens a timecard for the caller on the dispatch's work center, starting
now. Refused when the dispatch is Completed or Cancelled, or has no work
center.`,
  input: z.object({ dispatchId: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { dispatchId }) {
    const dispatch = await service.editableDispatch(ctx, dispatchId);
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

export const stopMaintenanceEvent = defineServiceFn({
  publish: true,
  title: "Stop a running timer on a maintenance dispatch",
  description: `Ends the timecard now. Refused when the dispatch is Completed or
Cancelled. Then the dispatch's labor is posted; when that fails, the timer
is still stopped and \`warning\` says so.`,
  input: z.object({ dispatchId: z.string(), eventId: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { dispatchId, eventId }) {
    const dispatch = await service.editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;

    const update = await ctx.asCaller.supabase
      .from("maintenanceDispatchEvent")
      .update({ endTime: datetime.timestamp(), updatedBy: ctx.auditUserId })
      .eq("id", eventId)
      .eq("maintenanceDispatchId", dispatchId)
      .eq("companyId", ctx.company.id)
      .select("id");
    if (update.error) {
      return ctx.error("internal", "Failed to stop event", update.error);
    }
    if (update.data.length === 0)
      return ctx.error("notFound", "Event not found");

    const postingError = await service.postMaintenanceLabor(ctx, [dispatchId]);
    return {
      id: eventId,
      warning: postingError
        ? "Event stopped, but its labor cost did not post"
        : null
    };
  }
});

export const issueMaintenancePart = defineServiceFn({
  publish: true,
  title: "Add a spare part to a maintenance dispatch and issue it from stock",
  description: `Refused when the dispatch is Completed or Cancelled, or the item is not the
company's. A serial or batch part names the tracked entities it takes in
\`children\`, each with a quantity more than 0; any other part takes
\`quantity\` (more than 0) from inventory at the dispatch's location. The
stock leaves inventory through the \`issue\` posting, whose refusal is
returned as it is.`,
  input: z.object({
    dispatchId: z.string(),
    itemId: z.string().min(1),
    unitOfMeasureCode: z.string().min(1),
    quantity: z.number().optional(),
    children: z
      .array(
        z.object({
          trackedEntityId: z.string(),
          quantity: z.number().positive()
        })
      )
      .optional()
  }),
  permission: { update: "resources" },

  async run(
    ctx,
    { dispatchId, itemId, unitOfMeasureCode, quantity, children }
  ) {
    const total = children
      ? children.reduce((sum, child) => sum + child.quantity, 0)
      : (quantity ?? 0);
    if (total <= 0) {
      return ctx.error("validation", "Quantity must be greater than 0");
    }

    const dispatch = await service.editableDispatch(ctx, dispatchId);
    if (dispatch instanceof CarbonError) return dispatch;
    const owned = await refuseUnlessOwned(ctx, "item", { id: itemId });
    if (owned) return owned;

    const tracked = !!children && children.length > 0;
    const issued = await invokePosting(
      ctx,
      "issue",
      tracked
        ? {
            type: "maintenanceDispatchTrackedEntities" as const,
            maintenanceDispatchId: dispatchId,
            itemId,
            unitOfMeasureCode,
            children
          }
        : {
            type: "maintenanceDispatchInventory" as const,
            maintenanceDispatchId: dispatchId,
            itemId,
            unitOfMeasureCode,
            quantity: total
          },
      inventoryPostings.issueMaterial
    );
    if (issued.error) return unwrap(ctx, issued) as CarbonError;
    return { dispatchId, itemId };
  }
});

export const unissueMaintenancePart = defineServiceFn({
  publish: "destructive",
  title:
    "Remove a spare part from a maintenance dispatch and return it to stock",
  description: `The part must be the dispatch's, and the dispatch not Completed or
Cancelled. The stock returns to inventory through the \`issue\` server
function.`,
  input: z.object({
    dispatchId: z.string(),
    maintenanceDispatchItemId: z.string()
  }),
  permission: { delete: "resources" },

  async run(ctx, { dispatchId, maintenanceDispatchItemId }) {
    const dispatch = await service.editableDispatch(ctx, dispatchId);
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

    const returned = await invokePosting(
      ctx,
      "issue",
      {
        type: "maintenanceDispatchUnissue",
        maintenanceDispatchItemId
      },
      inventoryPostings.issueMaterial
    );
    if (returned.error) return unwrap(ctx, returned) as CarbonError;
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
  "guidePath",
  "videoUrl"
] as const;

export const updateTrainingField = defineServiceFn({
  publish: true,
  title: "Set one field on one or more trainings",
  description: `\`content\` is the editor's document, as JSON; it needs \`resources\` update,
as the training table's policy does, and every other field \`people\` update
as well. An empty \`grantsAbilityId\` clears it. \`guidePath\` is the PDF that
replaces the written content: it takes one training, must be a key under
that training's folder (empty clears it), and changes only while the
training is Draft. \`videoUrl\` is a YouTube video that replaces the written
content the same way: any YouTube link is stored as its watch link. Setting
the PDF clears the video and setting the video clears the PDF. Refused when
a training is not the company's.`,
  input: z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum(trainingFields),
    value: z.string()
  }),
  // The editor wrote its content directly, under the training table's policy;
  // the other fields went through a route gated on people update.
  permission: { update: "resources" },

  async run(ctx, { ids, field, value }) {
    if (field !== "content" && !ctx.can({ update: "people" })) {
      return ctx.error("forbidden", "You do not have permission to do this");
    }
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };

    if (field === "guidePath" || field === "videoUrl") {
      const [trainingId] = ids;
      const isGuide = field === "guidePath";
      if (ids.length !== 1 || !trainingId) {
        return ctx.error(
          "validation",
          isGuide ? "Invalid guide file" : "Invalid video link"
        );
      }

      // A training's content is one PDF or one video, never both: setting
      // either clears the other.
      let content: { guidePath?: string | null; videoUrl?: string | null };
      if (isGuide) {
        if (
          value !== "" &&
          !isValidTrainingGuideKey(
            value,
            trainingGuideKeyPrefix(companyId, trainingId)
          )
        ) {
          return ctx.error("validation", "Invalid guide file");
        }
        content = value
          ? { guidePath: value, videoUrl: null }
          : { guidePath: null };
      } else {
        const videoId = value === "" ? null : getYouTubeVideoId(value);
        if (value !== "" && !videoId) {
          return ctx.error("validation", "Enter a YouTube video link");
        }
        content = videoId
          ? { videoUrl: youTubeWatchUrl(videoId), guidePath: null }
          : { videoUrl: null };
      }

      // The guide and the video are the training's content, so they change
      // only while Draft. Filtering the update on status makes the check and
      // the write one step.
      const updated = await client
        .from("training")
        .update({ ...content, ...audit })
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
          isGuide
            ? "The guide can only change while the training is Draft"
            : "The video can only change while the training is Draft"
        );
      }
      return { ids };
    }

    let fieldValue: unknown = value;
    if (field === "grantsAbilityId") fieldValue = value || null;
    if (field === "content") {
      try {
        fieldValue = JSON.parse(value);
      } catch {
        return ctx.error("validation", "Invalid training content");
      }
    }

    const updated = await client
      .from("training")
      .update(unchecked({ [field]: fieldValue, ...audit }))
      .in("id", ids)
      .eq("companyId", companyId)
      .select("id");
    if (updated.error) {
      return ctx.error("internal", "Failed to update training", updated.error);
    }
    if (updated.data.length < new Set(ids).size) {
      return ctx.error("notFound", "Training not found");
    }
    return { ids };
  }
});
export const createTrainingAssignment = defineServiceFn({
  publish: true,
  title: "Assign a training to groups",
  description: `An internal assignment names a training of this company; an external one
(\`isExternal\`) has only a name, because it happens in an outside system. A
training is assigned once: a second assignment would double every employee
in the status views, so edit the existing one instead. The groups of an
internal assignment are notified; an outside system notifies for an
external one.`,
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
      const existing = await service.getTrainingAssignments(
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

    const insert = await service.upsertTrainingAssignment(client, {
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
      await service.notifyTrainingAssignment(ctx, insert.data.id, groupIds);
    }
    return { id: insert.data.id };
  }
});

export const updateTrainingAssignment = defineServiceFn({
  publish: true,
  title: "Change a training assignment's groups, or an external one's name",
  description: `Internal or external is fixed at creation and read from the stored
assignment, never the input. The groups of an internal assignment are
notified.`,
  input: trainingAssignmentValidator.safeExtend({ id: z.string() }),
  permission: { update: "resources" },

  async run(ctx, { id, name, groupIds }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const stored = await service.getTrainingAssignment(client, id);
    if (stored.error || stored.data.companyId !== companyId) {
      return ctx.error(
        "notFound",
        "Training assignment not found",
        stored.error
      );
    }
    const isExternal = stored.data.trainingId === null;

    const update = await service.upsertTrainingAssignment(client, {
      id,
      name: isExternal ? name : null,
      groupIds,
      companyId,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update assignment", update.error);
    }

    if (!isExternal) await service.notifyTrainingAssignment(ctx, id, groupIds);
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

    const assignment = await service.getTrainingAssignment(
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

    const recorded = await service.recordTrainingCompletion(client, {
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

export const uncompleteTrainingAssignment = defineServiceFn({
  publish: "destructive",
  title: "Remove a wrong training completion",
  description: `Also deletes its certificate file, which holds employee data nothing points
at any more. The employee keeps any ability the completion granted: the
grant only adds, and the person may hold the ability for another reason.`,
  input: z.object({ completionId: zfd.numeric(z.number().int().positive()) }),
  permission: { delete: "resources" },

  async run(ctx, { completionId }) {
    const companyId = ctx.company.id;
    const removed = await service.deleteTrainingCompletion(
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
export const deleteContractor = defineServiceFn({
  publish: "destructive",
  title: "Delete contractor",
  input: z.looseObject({ contractorId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteContractor(
        ctx.asCaller.supabase,
        input.contractorId as never
      )
    );
  }
});

export const deleteFailureMode = defineServiceFn({
  publish: "destructive",
  title: "Delete failure mode",
  input: z.looseObject({ failureModeId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteFailureMode(
        ctx.asCaller.supabase,
        input.failureModeId as never
      )
    );
  }
});

export const deleteLocation = defineServiceFn({
  publish: "destructive",
  title: "Delete location",
  input: z.looseObject({ locationId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteLocation(
        ctx.asCaller.supabase,
        input.locationId as never
      )
    );
  }
});

export const deleteMaintenanceDispatch = defineServiceFn({
  publish: "destructive",
  title: "Delete maintenance dispatch",
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaintenanceDispatch(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

export const deleteMaintenanceSchedule = defineServiceFn({
  publish: "destructive",
  title: "Delete maintenance schedule",
  input: z.looseObject({ scheduleId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaintenanceSchedule(
        ctx.asCaller.supabase,
        input.scheduleId as never
      )
    );
  }
});

export const deletePartner = defineServiceFn({
  publish: "destructive",
  title: "Delete partner",
  input: z.looseObject({ partnerId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePartner(
        ctx.asCaller.supabase,
        input.partnerId as never
      )
    );
  }
});

export const activateProcess = defineServiceFn({
  publish: true,
  title: "Activate process",
  input: z.looseObject({ processId: z.string() }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.activateProcess(
        ctx.asCaller.supabase,
        input.processId as never
      )
    );
  }
});

export const processDeactivate = defineServiceFn({
  publish: true,
  title: "Process deactivate",
  input: z.looseObject({ processId: z.string() }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.processDeactivate(
        ctx.asCaller.supabase,
        input.processId as never
      )
    );
  }
});

export const deleteProcess = defineServiceFn({
  publish: "destructive",
  title: "Delete process",
  description: `Refused while anything references it: operations on a method, quote or
job, procedures, trainings, issue actions, supplier processes, shelf life
rules, or employees, contractors, partners and work centers holding its
ability. Deactivate it instead. Its work center links go with it.`,
  input: z.object({ processId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, { processId }) {
    const result = await ctx.transaction(async (tx) => {
      const deleted = await service.deleteProcess(tx.asSystem.pg, {
        id: processId,
        companyId: ctx.company.id
      });
      if (!deleted.found) return ctx.error("notFound", "Process not found");
      if (!deleted.deleted) {
        return ctx.error(
          "conflict",
          service.referencedRefusal("process", deleted.references)
        );
      }
      return { processId };
    });
    if (result.error) return result.error;
    return { processId };
  }
});

/**
 * What references a process: the rows that block deleting it.
 */
export const getProcessReferences = defineServiceFn({
  input: z.object({ processId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, { processId }) {
    return service.getProcessReferences(ctx.asSystem.pg, {
      id: processId,
      companyId: ctx.company.id
    });
  }
});

export const deleteShift = defineServiceFn({
  publish: "destructive",
  title: "Delete shift",
  input: z.looseObject({ shiftId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteShift(ctx.asCaller.supabase, input.shiftId as never)
    );
  }
});

export const deleteSuggestion = defineServiceFn({
  publish: "destructive",
  title: "Delete suggestion",
  input: z.looseObject({ suggestionId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSuggestion(
        ctx.asCaller.supabase,
        input.suggestionId as never
      )
    );
  }
});

export const deleteTraining = defineServiceFn({
  publish: "destructive",
  title: "Delete training",
  input: z.looseObject({ trainingId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteTraining(
        ctx.asCaller.supabase,
        input.trainingId as never
      )
    );
  }
});

export const deleteTrainingAssignment = defineServiceFn({
  publish: "destructive",
  title: "Delete training assignment",
  input: z.looseObject({ assignmentId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteTrainingAssignment(
        ctx.asCaller.supabase,
        input.assignmentId as never
      )
    );
  }
});

export const deleteTrainingQuestion = defineServiceFn({
  publish: "destructive",
  title: "Delete training question",
  input: z.looseObject({ trainingQuestionId: z.string() }),
  permission: { delete: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteTrainingQuestion(
        ctx.asCaller.supabase,
        input.trainingQuestionId as never,
        ctx.company.id
      )
    );
  }
});

export const getAbilities = defineServiceFn({
  publish: "read",
  title: "Get abilities",
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getAbilities(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getAbilitiesList = defineServiceFn({
  publish: "read",
  title: "Get abilities list",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getAbilitiesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getAbility = defineServiceFn({
  publish: "read",
  title: "Get ability",
  input: z.looseObject({ abilityId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAbility(ctx.asCaller.supabase, input.abilityId as never)
    );
  }
});

export const getContractor = defineServiceFn({
  publish: "read",
  title: "Get contractor",
  input: z.looseObject({ contractorId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getContractor(
        ctx.asCaller.supabase,
        input.contractorId as never
      )
    );
  }
});

export const getContractors = defineServiceFn({
  publish: "read",
  title: "Get contractors",
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getContractors(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getEmployeeAbilities = defineServiceFn({
  publish: "read",
  title: "Get employee abilities",
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEmployeeAbilities(
        ctx.asCaller.supabase,
        input.employeeId as never,
        ctx.company.id
      )
    );
  }
});

export const getEmployeeAbility = defineServiceFn({
  publish: "read",
  title: "Get employee ability",
  input: z.looseObject({ employeeAbilityId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEmployeeAbility(
        ctx.asCaller.supabase,
        input.employeeAbilityId as never
      )
    );
  }
});

export const getFailureMode = defineServiceFn({
  publish: "read",
  title: "Get failure mode",
  input: z.looseObject({ failureModeId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFailureMode(
        ctx.asCaller.supabase,
        input.failureModeId as never
      )
    );
  }
});

export const getFailureModes = defineServiceFn({
  publish: "read",
  title: "Get failure modes",
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getFailureModes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getFailureModesList = defineServiceFn({
  publish: "read",
  title: "Get failure modes list",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getFailureModesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getLocation = defineServiceFn({
  publish: "read",
  title: "Get location",
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLocation(
        ctx.asCaller.supabase,
        input.locationId as never
      )
    );
  }
});

export const getLocations = defineServiceFn({
  publish: "read",
  title: "Get locations",
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getLocations(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getLocationsList = defineServiceFn({
  publish: "read",
  title: "Get locations list",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getLocationsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getMaintenanceDispatch = defineServiceFn({
  publish: "read",
  title: "Get maintenance dispatch",
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatch(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

export const getMaintenanceDispatchComments = defineServiceFn({
  publish: "read",
  title: "Get maintenance dispatch comments",
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatchComments(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

export const getMaintenanceDispatchEvents = defineServiceFn({
  publish: "read",
  title: "Get maintenance dispatch events",
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatchEvents(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

export const getMaintenanceDispatchItems = defineServiceFn({
  publish: "read",
  title: "Get maintenance dispatch items",
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatchItems(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

export const getMaintenanceDispatchesByLocation = defineServiceFn({
  publish: "read",
  title: "Get maintenance dispatches by location",
  input: z.looseObject({
    locationId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaintenanceDispatchesByLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaintenanceSchedule = defineServiceFn({
  publish: "read",
  title: "Get maintenance schedule",
  input: z.looseObject({ scheduleId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceSchedule(
        ctx.asCaller.supabase,
        input.scheduleId as never
      )
    );
  }
});

export const getMaintenanceSchedulesByLocation = defineServiceFn({
  publish: "read",
  title: "Get maintenance schedules by location",
  input: z.looseObject({
    locationId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    active: z.boolean().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaintenanceSchedulesByLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getOutstandingTrainingsForUser = defineServiceFn({
  publish: "read",
  title: "Get outstanding trainings for user",
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOutstandingTrainingsForUser(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.employeeId as never
      )
    );
  }
});

export const getTrainingAssignmentStatusForEmployee = defineServiceFn({
  publish: "read",
  title: "Get training assignment status for employee",
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrainingAssignmentStatusForEmployee(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.employeeId as never
      )
    );
  }
});

export const getPartner = defineServiceFn({
  publish: "read",
  title: "Get partner",
  input: z.looseObject({ partnerId: z.string(), abilityId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPartner(
        ctx.asCaller.supabase,
        input.partnerId as never,
        input.abilityId as never
      )
    );
  }
});

export const getPartnerBySupplierId = defineServiceFn({
  publish: "read",
  title: "Get partner by supplier id",
  input: z.looseObject({ partnerId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPartnerBySupplierId(
        ctx.asCaller.supabase,
        input.partnerId as never
      )
    );
  }
});

export const getPartners = defineServiceFn({
  publish: "read",
  title: "Get partners",
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPartners(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getProcess = defineServiceFn({
  publish: "read",
  title: "Get process",
  input: z.looseObject({ processId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProcess(ctx.asCaller.supabase, input.processId as never)
    );
  }
});

export const getProcesses = defineServiceFn({
  publish: "read",
  title: "Get processes",
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProcesses(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getProcessesList = defineServiceFn({
  publish: "read",
  title: "Get processes list",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getProcessesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getSuggestion = defineServiceFn({
  publish: "read",
  title: "Get suggestion",
  input: z.looseObject({ suggestionId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSuggestion(
        ctx.asCaller.supabase,
        input.suggestionId as never
      )
    );
  }
});

export const getSuggestions = defineServiceFn({
  publish: "read",
  title: "Get suggestions",
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSuggestions(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getTraining = defineServiceFn({
  publish: "read",
  title: "Get training",
  input: z.looseObject({ id: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTraining(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getTrainingAssignment = defineServiceFn({
  publish: "read",
  title: "Get training assignment",
  input: z.looseObject({ assignmentId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrainingAssignment(
        ctx.asCaller.supabase,
        input.assignmentId as never
      )
    );
  }
});

export const getTrainingAssignmentForCompletion = defineServiceFn({
  publish: "read",
  title: "Get training assignment for completion",
  input: z.looseObject({ assignmentId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrainingAssignmentForCompletion(
        ctx.asCaller.supabase,
        input.assignmentId as never
      )
    );
  }
});

export const getTrainingAssignments = defineServiceFn({
  publish: "read",
  title: "Get training assignments",
  input: z.looseObject({ trainingId: z.string().optional() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrainingAssignments(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.trainingId as never
      )
    );
  }
});

export const getTrainingAssignmentStatus = defineServiceFn({
  publish: "read",
  title: "Get training assignment status",
  input: z.looseObject({
    trainingId: z.string().optional(),
    trainingAssignmentId: z.string().optional(),
    status: z
      .enum(["Completed", "Pending", "Overdue", "Not Required"])
      .optional(),
    search: z.string().optional()
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrainingAssignmentStatus(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getTrainingAssignmentSummary = defineServiceFn({
  publish: "read",
  title: "Get training assignment summary",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getTrainingAssignmentSummary(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

export const getTrainings = defineServiceFn({
  publish: "read",
  title: "Get trainings",
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getTrainings(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getTrainingsList = defineServiceFn({
  publish: "read",
  title: "Get trainings list",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getTrainingsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getWorkCenter = defineServiceFn({
  publish: "read",
  title: "Get work center",
  input: z.looseObject({ id: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getWorkCenter(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getWorkCenters = defineServiceFn({
  publish: "read",
  title: "Get work centers",
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getWorkCenters(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getWorkCentersByLocation = defineServiceFn({
  publish: "read",
  title: "Get work centers by location",
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getWorkCentersByLocation(
        ctx.asCaller.supabase,
        input.locationId as never
      )
    );
  }
});

export const getWorkCentersList = defineServiceFn({
  publish: "read",
  title: "Get work centers list",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getWorkCentersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getWorkCentersListWithBlockingStatus = defineServiceFn({
  publish: "read",
  title: "Get work centers list with blocking status",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getWorkCentersListWithBlockingStatus(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

export const getProcessesWithoutAbility = defineServiceFn({
  publish: "read",
  title: "Processes that do not yet have an ability",
  input: z.record(z.string(), z.unknown()),
  permission: { view: "resources" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getProcessesWithoutAbility(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

export const updateAbility = defineServiceFn({
  publish: true,
  title: "Update ability",
  input: z.looseObject({
    id: z.string(),
    ability: z.looseObject({
      name: z.string().optional(),
      recertifyEveryDays: z.number().nullable().optional()
    })
  }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateAbility(
        ctx.asCaller.supabase,
        input.id as never,
        payload(ctx, input.ability).forUpdate() as never
      )
    );
  }
});

export const updateSuggestionEmoji = defineServiceFn({
  publish: true,
  title: "Update suggestion emoji",
  input: z.looseObject({ suggestionId: z.string(), emoji: z.string() }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSuggestionEmoji(
        ctx.asCaller.supabase,
        input.suggestionId as never,
        input.emoji as never
      )
    );
  }
});

export const updateTrainingQuestionOrder = defineServiceFn({
  publish: true,
  title: "Update training question order",
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.updateTrainingQuestionOrder(
        ctx.asCaller.supabase,
        payload(ctx, input.updates).forUpdate() as never
      ))
    );
  }
});

export const createContractor = defineServiceFn({
  publish: "destructive",
  title: "Create a contractor",
  description: "Upsert contractor",
  input: z.looseObject({
    id: z
      .string()
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    hoursPerWeek: z.number().optional(),
    abilities: z
      .array(z.string())
      .optional()
      .describe(
        "Replaces the contractor's abilities when sent; left out, they are kept."
      ),
    customFields: z.unknown().optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertContractor(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateContractor = defineServiceFn({
  publish: "destructive",
  title: "Update a contractor",
  description: "Upsert contractor",
  input: z.looseObject({
    id: z
      .string()
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    hoursPerWeek: z.number().optional(),
    abilities: z
      .array(z.string())
      .optional()
      .describe(
        "Replaces the contractor's abilities when sent; left out, they are kept."
      ),
    customFields: z.unknown().optional()
  }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertContractor(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createFailureMode = defineServiceFn({
  publish: true,
  title: "Create a failure mode",
  description: "Upsert failure mode",
  input: z.looseObject({
    name: z.string().min(1),
    type: z.enum(["Maintenance", "Quality", "Operations", "Other"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertFailureMode(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateFailureMode = defineServiceFn({
  publish: true,
  title: "Update a failure mode",
  description: "Upsert failure mode",
  input: z
    .looseObject({
      name: z.string().min(1),
      type: z.enum(["Maintenance", "Quality", "Operations", "Other"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertFailureMode(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createMaintenanceDispatchComment = defineServiceFn({
  publish: true,
  title: "Create a maintenance dispatch comment",
  description: "Upsert maintenance dispatch comment",
  input: z.looseObject({
    maintenanceDispatchId: z.string().min(1),
    comment: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchComment(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateMaintenanceDispatchComment = defineServiceFn({
  publish: true,
  title: "Update a maintenance dispatch comment",
  description: "Upsert maintenance dispatch comment",
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      comment: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchComment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createMaintenanceDispatchItem = defineServiceFn({
  publish: true,
  title: "Add a spare part to a maintenance dispatch, issued from inventory",
  description: `The same as \`issueMaintenancePart\` with a \`quantity\`: refused when the
dispatch is Completed or Cancelled, and the stock leaves inventory at the
dispatch's location, at its cost. A serial or batch part is issued with
\`issueMaintenancePart\`, which names its tracked entities.`,
  input: z.object({
    maintenanceDispatchId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: z.number().min(1),
    unitOfMeasureCode: z.string().min(1)
  }),
  permission: { update: "resources" },
  async run(
    ctx,
    { maintenanceDispatchId, itemId, quantity, unitOfMeasureCode }
  ) {
    return issueMaintenancePart(ctx, {
      dispatchId: maintenanceDispatchId,
      itemId,
      unitOfMeasureCode,
      quantity
    });
  }
});

export const updateMaintenanceDispatchItem = defineServiceFn({
  publish: true,
  title: "Update a maintenance dispatch item",
  description: `Refused when the dispatch is Completed or Cancelled, or the item is not on
it. Moves no stock.`,
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      itemId: z.string().min(1),
      quantity: z.number().min(1),
      unitOfMeasureCode: z.string().min(1),
      unitCost: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    const dispatch = await service.editableDispatch(
      ctx,
      input.maintenanceDispatchId
    );
    if (dispatch instanceof CarbonError) return dispatch;
    const owned = await refuseUnlessOwned(ctx, "item", { id: input.itemId });
    if (owned) return owned;
    const updated = await ctx.asCaller.supabase
      .from("maintenanceDispatchItem")
      .update({
        itemId: input.itemId,
        quantity: input.quantity,
        unitOfMeasureCode: input.unitOfMeasureCode,
        ...(input.unitCost !== undefined && { unitCost: input.unitCost }),
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", input.id)
      .eq("maintenanceDispatchId", input.maintenanceDispatchId)
      .eq("companyId", ctx.company.id)
      .select("id");
    if (updated.error) {
      return ctx.error("internal", "Failed to update the part", updated.error);
    }
    if (updated.data.length === 0)
      return ctx.error("notFound", "Part not found");
    return { id: input.id };
  }
});

export const createPartner = defineServiceFn({
  publish: true,
  title: "Create a partner",
  description: "Upsert partner",
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    hoursPerWeek: z.number().min(0),
    customFields: z.unknown().optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPartner(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updatePartner = defineServiceFn({
  publish: true,
  title: "Update a partner",
  description: "Upsert partner",
  input: z
    .looseObject({
      id: z
        .string()
        .min(1)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      hoursPerWeek: z.number().min(0),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPartner(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createTraining = defineServiceFn({
  publish: true,
  title: "Create a training",
  description: "Upsert training",
  input: z.looseObject({
    name: z.string().min(1),
    content: optionalTiptapDoc,
    grantsAbilityId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertTraining(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateTraining = defineServiceFn({
  publish: true,
  title: "Update a training",
  description: "Upsert training",
  input: z
    .looseObject({
      name: z.string().min(1),
      content: optionalTiptapDoc,
      grantsAbilityId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertTraining(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createTrainingQuestion = defineServiceFn({
  publish: true,
  title: "Create a training question",
  description: "Upsert training question",
  input: z.looseObject({
    trainingId: z.string().min(1),
    question: z.string().min(1),
    type: z.enum([
      "MultipleChoice",
      "TrueFalse",
      "MultipleAnswers",
      "MatchingPairs",
      "Numerical"
    ]),
    sortOrder: z.number().min(0).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    correctAnswers: z.union([z.string(), z.array(z.string())]).optional(),
    correctBoolean: z.union([z.boolean(), z.string()]).optional(),
    matchingPairs: z.string().optional(),
    correctNumber: z.number().optional(),
    tolerance: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertTrainingQuestion(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateTrainingQuestion = defineServiceFn({
  publish: true,
  title: "Update a training question",
  description: "Upsert training question",
  input: z
    .looseObject({
      trainingId: z.string().min(1),
      question: z.string().min(1),
      type: z.enum([
        "MultipleChoice",
        "TrueFalse",
        "MultipleAnswers",
        "MatchingPairs",
        "Numerical"
      ]),
      sortOrder: z.number().min(0).optional(),
      required: z.boolean().optional(),
      options: z.array(z.string()).optional(),
      correctAnswers: z.union([z.string(), z.array(z.string())]).optional(),
      correctBoolean: z.union([z.boolean(), z.string()]).optional(),
      matchingPairs: z.string().optional(),
      correctNumber: z.number().optional(),
      tolerance: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "resources" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertTrainingQuestion(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});
