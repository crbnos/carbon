// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  defineServiceFn,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import { z } from "zod";
import { notifyScheduleInputsChanged } from "~/modules/production/production.service";
import { employeeJobValidator } from "./people.models";
import {
  clockIn,
  clockOut,
  createTimeCardEntry,
  deleteTimeCardEntry,
  updateEmployeeJob,
  updateTimeCardEntry,
  upsertShift
} from "./people.service";

/** Custom field values, as `setCustomFields` reads them off a form. */
const customFieldValues = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);

const shiftInput = z.object({
  name: z.string().trim().min(1, { message: "Name is required" }),
  startTime: z.string().min(1, { message: "Start time is required" }),
  endTime: z.string().min(1, { message: "End time is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  monday: z.boolean(),
  tuesday: z.boolean(),
  wednesday: z.boolean(),
  thursday: z.boolean(),
  friday: z.boolean(),
  saturday: z.boolean(),
  sunday: z.boolean(),
  customFields: customFieldValues.optional()
});

/**
 * Create a shift.
 *
 * @remarks
 * Saves a work schedule at a location: its start and end times and the days
 * of the week it runs.
 *
 * @mcp
 */
export const createShift = defineServiceFn({
  input: shiftInput,
  permission: { create: "people" },
  async run(ctx, shift) {
    const created = await upsertShift(ctx.asCaller.supabase, {
      ...shift,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to create shift", created.error);
    }
    return { id: created.data.id };
  }
});

/**
 * Change a shift.
 *
 * @remarks
 * Saves the shift, then marks the company's active jobs as needing a new
 * schedule, because the hours people can work have changed.
 *
 * @mcp
 */
export const updateShift = defineServiceFn({
  input: shiftInput.extend({ id: z.string().min(1) }),
  // The route always required create, not update, to edit a shift.
  permission: { create: "people" },
  async run(ctx, shift) {
    const updated = await upsertShift(ctx.asCaller.supabase, {
      ...shift,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to create shift", updated.error);
    }
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "shift",
      "Shift hours changed"
    );
    return { id: shift.id };
  }
});

/**
 * Change a person's job: title, start date, location, shift, department and
 * manager.
 *
 * @remarks
 * Every id is checked against the company, and the person's shift
 * assignment for scheduling is kept in step with the job, in one
 * transaction. Then the company's active jobs are marked as needing a new
 * schedule. Refused when the person, location, shift, department or manager
 * is not in the company.
 *
 * @mcp
 */
export const updatePersonJob = defineServiceFn({
  input: employeeJobValidator.extend({
    employeeId: z.string().min(1),
    customFields: customFieldValues.optional()
  }),
  permission: { update: "people" },
  async run(ctx, { employeeId, ...job }) {
    const updated = await updateEmployeeJob(ctx.asSystem.pg, employeeId, {
      ...job,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update job", updated.error);
    }
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "employee-shift",
      "Shift assignment changed"
    );
    return { employeeId };
  }
});

/**
 * A time card helper's refusal ("Already clocked in") carries no database
 * code; a database error does.
 */
function timeCardError(
  ctx: ServiceContext,
  error: { message: string; code?: string },
  message: string
) {
  return "code" in error
    ? ctx.error("internal", message, error)
    : ctx.error("rule", error.message);
}

// The person timecard page has always let anyone with people view clock a
// person in or out and edit their entries. That is kept as it was, so these
// stay unpublished: an API key with view access must not write time.

/** Clock a person in. Refused when they are already clocked in. */
export const clockInPerson = defineServiceFn({
  input: z.object({ employeeId: z.string().min(1) }),
  permission: { view: "people" },
  async run(ctx, { employeeId }) {
    const result = await clockIn(ctx.asCaller.supabase, {
      employeeId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (result.error)
      return timeCardError(ctx, result.error, "Failed to clock in");
    return { employeeId };
  }
});

/** Clock a person out of their open time card entry. */
export const clockOutPerson = defineServiceFn({
  input: z.object({
    employeeId: z.string().min(1),
    note: z.string().optional()
  }),
  permission: { view: "people" },
  async run(ctx, { employeeId, note }) {
    const result = await clockOut(ctx.asCaller.supabase, {
      employeeId,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      note
    });
    if (result.error) {
      return timeCardError(ctx, result.error, "Failed to clock out");
    }
    return { employeeId };
  }
});

/** Add a time card entry for a person. */
export const addPersonTimeCardEntry = defineServiceFn({
  input: z.object({
    employeeId: z.string().min(1),
    clockIn: z.string().min(1),
    clockOut: z.string().optional()
  }),
  permission: { view: "people" },
  async run(ctx, entry) {
    const created = await createTimeCardEntry(ctx.asCaller.supabase, {
      employeeId: entry.employeeId,
      companyId: ctx.company.id,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut || null,
      createdBy: ctx.auditUserId
    });
    if (created.error) {
      return ctx.error("internal", "Failed to add entry", created.error);
    }
    return { id: created.data.id };
  }
});

/** Change a time card entry's times and note. */
export const updatePersonTimeCardEntry = defineServiceFn({
  input: z.object({
    entryId: z.string().min(1),
    clockIn: z.string().min(1),
    clockOut: z.string().optional(),
    note: z.string().optional()
  }),
  permission: { view: "people" },
  async run(ctx, entry) {
    const updated = await updateTimeCardEntry(ctx.asCaller.supabase, {
      entryId: entry.entryId,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut || null,
      note: entry.note || null,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update entry", updated.error);
    }
    return { id: entry.entryId };
  }
});

/** Delete a time card entry. */
export const deletePersonTimeCardEntry = defineServiceFn({
  input: z.object({ entryId: z.string().min(1) }),
  permission: { view: "people" },
  async run(ctx, { entryId }) {
    const deleted = await deleteTimeCardEntry(ctx.asCaller.supabase, entryId);
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete entry", deleted.error);
    }
    return { id: entryId };
  }
});

/** Clock the caller in. Refused when they are already clocked in. */
export const clockInSelf = defineServiceFn({
  input: z.object({}),
  permission: {},
  async run(ctx) {
    const result = await clockIn(ctx.asCaller.supabase, {
      employeeId: ctx.auditUserId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (result.error)
      return timeCardError(ctx, result.error, "Failed to clock in");
    return { employeeId: ctx.auditUserId };
  }
});

/**
 * Clock the caller out of their open time card entry, at `clockOut` when
 * given (the "Forgot to clock out?" prompt), else now.
 */
export const clockOutSelf = defineServiceFn({
  input: z.object({
    clockOut: z.string().optional(),
    note: z.string().optional()
  }),
  permission: {},
  async run(ctx, { clockOut: at, note }) {
    const result = await clockOut(ctx.asCaller.supabase, {
      employeeId: ctx.auditUserId,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      clockOut: at || undefined,
      note: note || undefined
    });
    if (result.error) {
      return timeCardError(ctx, result.error, "Failed to clock out");
    }
    return { employeeId: ctx.auditUserId };
  }
});
