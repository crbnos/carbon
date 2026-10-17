// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { z } from "zod";
import { notifyScheduleInputsChanged } from "~/modules/production/production.service";
import { employeeJobValidator } from "./people.models";
import * as service from "./people.service";

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
    const created = await service.upsertShift(ctx.asCaller.supabase, {
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
 * schedule, because the hours people can work have changed. Refused when the
 * shift is not the company's.
 *
 * @mcp
 */
export const updateShift = defineServiceFn({
  input: shiftInput.extend({ id: z.string().min(1) }),
  // The route gated on create; the write runs under the update policy.
  permission: { create: "people", update: "people" },
  async run(ctx, shift) {
    const updated = await service.upsertShift(ctx.asCaller.supabase, {
      ...shift,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update shift", updated.error);
    }
    if (!updated.data) return ctx.error("notFound", "Shift not found");
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
    const updated = await service.updateEmployeeJob(
      ctx.asSystem.pg,
      employeeId,
      {
        ...job,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      }
    );
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
// The person timecard page has always let anyone with people view clock a
// person in or out and edit their entries. That is kept as it was, so these
// stay unpublished: an API key with view access must not write time.

/** Clock a person in. Refused when they are already clocked in. */
export const clockInPerson = defineServiceFn({
  input: z.object({ employeeId: z.string().min(1) }),
  permission: { view: "people" },
  async run(ctx, { employeeId }) {
    const result = await service.clockIn(ctx.asCaller.supabase, {
      employeeId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (result.error)
      return service.timeCardError(ctx, result.error, "Failed to clock in");
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
    const result = await service.clockOut(ctx.asCaller.supabase, {
      employeeId,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      note
    });
    if (result.error) {
      return service.timeCardError(ctx, result.error, "Failed to clock out");
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
    const created = await service.createTimeCardEntry(ctx.asCaller.supabase, {
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
    const updated = await service.updateTimeCardEntry(ctx.asCaller.supabase, {
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
    const deleted = await service.deleteTimeCardEntry(
      ctx.asCaller.supabase,
      entryId
    );
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
    const result = await service.clockIn(ctx.asCaller.supabase, {
      employeeId: ctx.auditUserId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (result.error)
      return service.timeCardError(ctx, result.error, "Failed to clock in");
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
    const result = await service.clockOut(ctx.asCaller.supabase, {
      employeeId: ctx.auditUserId,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      clockOut: at || undefined,
      note: note || undefined
    });
    if (result.error) {
      return service.timeCardError(ctx, result.error, "Failed to clock out");
    }
    return { employeeId: ctx.auditUserId };
  }
});
/**
 * Delete attribute
 *
 * @mcp destructive
 */
export const deleteAttribute = defineServiceFn({
  input: z.looseObject({ attributeId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAttribute(
        ctx.asCaller.supabase,
        input.attributeId as never
      )
    );
  }
});

/**
 * Delete attribute category
 *
 * @mcp destructive
 */
export const deleteAttributeCategory = defineServiceFn({
  input: z.looseObject({ attributeCategoryId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAttributeCategory(
        ctx.asCaller.supabase,
        input.attributeCategoryId as never
      )
    );
  }
});

/**
 * Delete department
 *
 * @mcp destructive
 */
export const deleteDepartment = defineServiceFn({
  input: z.looseObject({ departmentId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteDepartment(
        ctx.asCaller.supabase,
        input.departmentId as never
      )
    );
  }
});

/**
 * Delete holiday
 *
 * @mcp destructive
 */
export const deleteHoliday = defineServiceFn({
  input: z.looseObject({ holidayId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteHoliday(
        ctx.asCaller.supabase,
        input.holidayId as never
      )
    );
  }
});

/**
 * Delete shift
 *
 * @mcp destructive
 */
export const deleteShift = defineServiceFn({
  input: z.looseObject({ shiftId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteShift(ctx.asCaller.supabase, input.shiftId as never)
    );
  }
});

/**
 * Get attribute
 *
 * @mcp read
 */
export const getAttribute = defineServiceFn({
  input: z.looseObject({ attributeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAttribute(
        ctx.asCaller.supabase,
        input.attributeId as never
      )
    );
  }
});

/**
 * Get attribute categories
 *
 * @mcp read
 */
export const getAttributeCategories = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "people" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getAttributeCategories(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get attribute category
 *
 * @mcp read
 */
export const getAttributeCategory = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAttributeCategory(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get attribute data types
 *
 * @mcp read
 */
export const getAttributeDataTypes = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getAttributeDataTypes(ctx.asCaller.supabase)
    );
  }
});

/**
 * Get department
 *
 * @mcp read
 */
export const getDepartment = defineServiceFn({
  input: z.looseObject({ departmentId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDepartment(
        ctx.asCaller.supabase,
        input.departmentId as never
      )
    );
  }
});

/**
 * Get departments list
 *
 * @mcp read
 */
export const getDepartmentsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDepartmentsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get departments tree
 *
 * @mcp read
 */
export const getDepartmentsTree = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDepartmentsTree(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get employee job
 *
 * @mcp read
 */
export const getEmployeeJob = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEmployeeJob(
        ctx.asCaller.supabase,
        input.employeeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get employee summary
 *
 * @mcp read
 */
export const getEmployeeSummary = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEmployeeSummary(
        ctx.asCaller.supabase,
        input.employeeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get holiday
 *
 * @mcp read
 */
export const getHoliday = defineServiceFn({
  input: z.looseObject({ holidayId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getHoliday(ctx.asCaller.supabase, input.holidayId as never)
    );
  }
});

/**
 * Get holidays
 *
 * @mcp read
 */
export const getHolidays = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "people" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getHolidays(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get holiday years
 *
 * @mcp read
 */
export const getHolidayYears = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getHolidayYears(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get people
 *
 * @mcp read
 */
export const getPeople = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPeople(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get shift
 *
 * @mcp read
 */
export const getShift = defineServiceFn({
  input: z.looseObject({ shiftId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getShift(ctx.asCaller.supabase, input.shiftId as never)
    );
  }
});

/**
 * Get shifts
 *
 * @mcp read
 */
export const getShifts = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "people" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getShifts(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get shifts list
 *
 * @mcp read
 */
export const getShiftsList = defineServiceFn({
  input: z.looseObject({ locationId: z.string().nullable() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getShiftsList(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get employee shifts
 *
 * @mcp read
 */
export const getEmployeeShifts = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getEmployeeShifts(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get employee departments
 *
 * @mcp read
 */
export const getEmployeeDepartments = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getEmployeeDepartments(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get shifts with times
 *
 * @mcp read
 */
export const getShiftsWithTimes = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getShiftsWithTimes(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Insert attribute
 *
 * @mcp
 */
export const insertAttribute = defineServiceFn({
  input: z.looseObject({
    name: z.string(),
    attributeDataTypeId: z.number(),
    userAttributeCategoryId: z.string(),
    listOptions: z.array(z.string()).optional(),
    canSelfManage: z.boolean()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertAttribute(
        ctx.asCaller.supabase,
        payload(ctx, input).withoutCompany().forCreate() as never
      )
    );
  }
});

/**
 * Insert attribute category
 *
 * @mcp
 */
export const insertAttributeCategory = defineServiceFn({
  input: z.looseObject({
    name: z.string(),
    emoji: z.string().optional(),
    public: z.boolean()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertAttributeCategory(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Insert employee job
 *
 * @mcp
 */
export const insertEmployeeJob = defineServiceFn({
  input: z.looseObject({ id: z.string(), locationId: z.string() }),
  permission: { create: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertEmployeeJob(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update attribute
 *
 * @mcp
 */
export const updateAttribute = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    listOptions: z.array(z.string()).optional(),
    canSelfManage: z.boolean()
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateAttribute(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update attribute category
 *
 * @mcp
 */
export const updateAttributeCategory = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    name: z.string(),
    emoji: z.string().optional(),
    public: z.boolean()
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateAttributeCategory(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update attribute sort order
 *
 * @mcp
 */
export const updateAttributeSortOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.updateAttributeSortOrder(
        ctx.asCaller.supabase,
        payload(ctx, input.updates).forUpdate() as never
      ))
    );
  }
});

/**
 * Create a department
 *
 * @remarks
 * Upsert department
 *
 * @mcp
 */
export const createDepartment = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    parentDepartmentId: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertDepartment(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a department
 *
 * @remarks
 * Upsert department
 *
 * @mcp
 */
export const updateDepartment = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      parentDepartmentId: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertDepartment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a holiday
 *
 * @remarks
 * Upsert holiday
 *
 * @mcp
 */
export const createHoliday = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    date: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertHoliday(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a holiday
 *
 * @remarks
 * Upsert holiday
 *
 * @mcp
 */
export const updateHoliday = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      date: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertHoliday(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create time card entry
 *
 * @mcp
 */
export const createTimeCardEntry = defineServiceFn({
  input: z.looseObject({
    employeeId: z.string(),
    clockIn: z.string(),
    clockOut: z.string().nullable().optional(),
    note: z.string().nullable().optional()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createTimeCardEntry(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Delete time card entry
 *
 * @mcp destructive
 */
export const deleteTimeCardEntry = defineServiceFn({
  input: z.looseObject({ entryId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteTimeCardEntry(
        ctx.asCaller.supabase,
        input.entryId as never
      )
    );
  }
});

/**
 * Get open clock entry
 *
 * @mcp read
 */
export const getOpenClockEntry = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenClockEntry(
        ctx.asCaller.supabase,
        input.employeeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get time card entry
 *
 * @mcp read
 */
export const getTimeCardEntry = defineServiceFn({
  input: z.looseObject({ entryId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTimeCardEntry(
        ctx.asCaller.supabase,
        input.entryId as never
      )
    );
  }
});

/**
 * Get time card entries
 *
 * @mcp read
 */
export const getTimeCardEntries = defineServiceFn({
  input: z.looseObject({
    employeeId: z.string(),
    from: z.string().optional(),
    to: z.string().optional()
  }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTimeCardEntries(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get timecard entries
 *
 * @mcp read
 */
export const getTimecardEntries = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "people" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getTimecardEntries(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Update time card entry
 *
 * @mcp
 */
export const updateTimeCardEntry = defineServiceFn({
  input: z.looseObject({
    entryId: z.string(),
    clockIn: z.string().optional(),
    clockOut: z.string().nullable().optional(),
    note: z.string().nullable().optional()
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateTimeCardEntry(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});
