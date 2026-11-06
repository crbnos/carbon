// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { rows } from "@carbon/database/row-schemas";
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

export const createShift = defineServiceFn({
  publish: true,
  title: "Create a shift",
  description: `Saves a work schedule at a location: its start and end times and the days
of the week it runs.`,
  output: rows.shift.pick({ id: true }).meta({ table: "shift" }),
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
    // A new location shift adds hours to every work center that runs all of
    // the location's shifts.
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "shift",
      "Shift added",
      created.data.id
    );
    return { id: created.data.id };
  }
});

export const updateShift = defineServiceFn({
  publish: true,
  title: "Change a shift",
  description: `Saves the shift, then marks the company's active jobs as needing a new
schedule, because the hours people can work have changed. Refused when the
shift is not the company's.`,
  output: rows.shift.pick({ id: true }).meta({ table: "shift" }),
  input: shiftInput.extend({ id: z.string().min(1) }),
  // The route gated on create; the write runs under the update policy.
  permission: { create: "people", update: "people" },
  async run(ctx, shift) {
    const previous = await ctx.asCaller.supabase
      .from("shift")
      .select("locationId")
      .eq("id", shift.id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (previous.error) {
      return ctx.error("internal", "Failed to update shift", previous.error);
    }
    const updated = await service.upsertShift(ctx.asCaller.supabase, {
      ...shift,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update shift", updated.error);
    }
    if (!updated.data) return ctx.error("notFound", "Shift not found");
    // A shift moved to another location also changes the hours of the
    // stations it leaves behind, which the shift-scoped notice cannot see.
    const moved =
      previous.data !== null && previous.data.locationId !== shift.locationId;
    await notifyScheduleInputsChanged(
      ctx.company.id,
      moved ? "location" : "shift",
      moved ? "Shift moved to another location" : "Shift hours changed",
      moved ? undefined : shift.id
    );
    return { id: shift.id };
  }
});

export const updatePersonJob = defineServiceFn({
  publish: true,
  title:
    "Change a person's job: title, start date, location, shift, department, manager, and the project time fields (labor category, FLSA status, officer, timesheet required)",
  description: `Every id is checked against the company, and the person's shift
assignment for scheduling is kept in step with the job, in one
transaction. Then the company's active jobs are marked as needing a new
schedule. Refused when the person, location, shift, department, manager
or labor category is not in the company. \`isOfficer\` and
\`timesheetRequired\` left out keep their stored values.`,
  output: z.object({
    employeeId: z.string()
  }),
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
export const deleteAttribute = defineServiceFn({
  publish: "destructive",
  title: "Delete attribute",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
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

export const deleteAttributeCategory = defineServiceFn({
  publish: "destructive",
  title: "Delete attribute category",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
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

export const deleteDepartment = defineServiceFn({
  publish: "destructive",
  title: "Delete department",
  output: z.array(
    rows.department.pick({ id: true }).meta({ table: "department" })
  ),
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

export const deleteHoliday = defineServiceFn({
  publish: "destructive",
  title: "Delete holiday",
  output: z.array(rows.holiday.pick({ id: true }).meta({ table: "holiday" })),
  input: z.looseObject({ holidayId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    const deleted = unwrap(
      ctx,
      await service.deleteHoliday(
        ctx.asCaller.supabase,
        input.holidayId as never
      )
    );
    if (deleted instanceof CarbonError) return deleted;
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "location",
      "Company holidays changed"
    );
    return deleted;
  }
});

export const deleteShift = defineServiceFn({
  publish: "destructive",
  title: "Delete shift",
  output: z.array(rows.shift.pick({ id: true }).meta({ table: "shift" })),
  input: z.looseObject({ shiftId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    const deleted = unwrap(
      ctx,
      await service.deleteShift(ctx.asCaller.supabase, input.shiftId as never)
    );
    if (deleted instanceof CarbonError) return deleted;
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "shift",
      "Shift removed",
      input.shiftId
    );
    return deleted;
  }
});

export const getAttribute = defineServiceFn({
  publish: "read",
  title: "Get attribute",
  output: z.object({
    active: z.boolean().nullable(),
    attributeDataTypeId: z.number(),
    canSelfManage: z.boolean().nullable(),
    createdAt: z.string(),
    createdBy: z.string(),
    id: z.string(),
    listOptions: z.array(z.string()).nullable(),
    name: z.string(),
    sortOrder: z.number(),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable(),
    userAttributeCategoryId: z.string(),
    userAttributeCategory: z.object({
      name: z.string()
    })
  }),
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

export const getAttributeCategories = defineServiceFn({
  publish: "read",
  title: "Get attribute categories",
  output: z
    .array(
      z.object({
        active: z.boolean().nullable(),
        companyId: z.string().nullable(),
        createdAt: z.string(),
        createdBy: z.string(),
        emoji: z.string().nullable(),
        id: z.string(),
        name: z.string(),
        protected: z.boolean().nullable(),
        public: z.boolean().nullable(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable(),
        userAttribute: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            attributeDataType: z.object({
              id: z.number()
            })
          })
        )
      })
    )
    .nullable(),
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

export const getAttributeCategory = defineServiceFn({
  publish: "read",
  title: "Get attribute category",
  output: z.object({
    active: z.boolean().nullable(),
    companyId: z.string().nullable(),
    createdAt: z.string(),
    createdBy: z.string(),
    emoji: z.string().nullable(),
    id: z.string(),
    name: z.string(),
    protected: z.boolean().nullable(),
    public: z.boolean().nullable(),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable(),
    userAttribute: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sortOrder: z.number(),
        attributeDataType: z.object({
          id: z.number(),
          label: z.string(),
          isBoolean: z.boolean(),
          isDate: z.boolean(),
          isList: z.boolean(),
          isNumeric: z.boolean(),
          isText: z.boolean(),
          isUser: z.boolean(),
          isFile: z.boolean()
        })
      })
    )
  }),
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

export const getAttributeDataTypes = defineServiceFn({
  publish: "read",
  title: "Get attribute data types",
  output: z.array(rows.attributeDataType),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getAttributeDataTypes(ctx.asCaller.supabase)
    );
  }
});

export const getDepartment = defineServiceFn({
  publish: "read",
  title: "Get department",
  output: rows.department
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      parentDepartmentId: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "department" }),
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

export const getDepartmentsList = defineServiceFn({
  publish: "read",
  title: "Get departments list",
  output: z.array(
    rows.department.pick({ id: true, name: true }).meta({ table: "department" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDepartmentsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getDepartmentsTree = defineServiceFn({
  publish: "read",
  title: "Get departments tree",
  output: z.array(
    rows.department
      .pick({ id: true, name: true, parentDepartmentId: true })
      .meta({ table: "department" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDepartmentsTree(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getEmployeeJob = defineServiceFn({
  publish: "read",
  title: "Get employee job",
  output: rows.employeeJob
    .pick({
      companyId: true,
      defaultStorageUnitId: true,
      departmentId: true,
      flsaStatus: true,
      id: true,
      isOfficer: true,
      laborCategoryId: true,
      locationId: true,
      managerId: true,
      shiftId: true,
      startDate: true,
      tags: true,
      timesheetRequired: true,
      title: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "employeeJob" }),
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

export const getEmployeeSummary = defineServiceFn({
  publish: "read",
  title: "Get employee summary",
  output: rows.employeeSummary,
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

export const getHoliday = defineServiceFn({
  publish: "read",
  title: "Get holiday",
  output: rows.holiday
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      date: true,
      id: true,
      name: true,
      tags: true,
      updatedAt: true,
      updatedBy: true,
      year: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "holiday" }),
  input: z.looseObject({ holidayId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getHoliday(ctx.asCaller.supabase, input.holidayId as never)
    );
  }
});

export const getHolidays = defineServiceFn({
  publish: "read",
  title: "Get holidays",
  output: z
    .array(
      rows.holiday
        .pick({
          companyId: true,
          createdAt: true,
          createdBy: true,
          date: true,
          id: true,
          name: true,
          tags: true,
          updatedAt: true,
          updatedBy: true,
          year: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
        .meta({ table: "holiday" })
    )
    .nullable(),
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

export const getHolidayYears = defineServiceFn({
  publish: "read",
  title: "Get holiday years",
  output: z.array(rows.holidayYears.pick({ year: true })),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getHolidayYears(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getPeople = defineServiceFn({
  publish: "read",
  title: "Get people",
  output: z.array(z.unknown()),
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

export const getShift = defineServiceFn({
  publish: "read",
  title: "Get shift",
  output: rows.shifts
    .pick({
      active: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      endTime: true,
      friday: true,
      id: true,
      locationId: true,
      locationName: true,
      monday: true,
      name: true,
      saturday: true,
      startTime: true,
      sunday: true,
      thursday: true,
      tuesday: true,
      updatedAt: true,
      updatedBy: true,
      wednesday: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "shift" }),
  input: z.looseObject({ shiftId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getShift(ctx.asCaller.supabase, input.shiftId as never)
    );
  }
});

export const getShifts = defineServiceFn({
  publish: "read",
  title: "Get shifts",
  output: z
    .array(
      rows.shifts
        .pick({
          active: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          endTime: true,
          friday: true,
          id: true,
          locationId: true,
          locationName: true,
          monday: true,
          name: true,
          saturday: true,
          startTime: true,
          sunday: true,
          thursday: true,
          tuesday: true,
          updatedAt: true,
          updatedBy: true,
          wednesday: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
        .meta({ table: "shift" })
    )
    .nullable(),
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

export const getShiftsList = defineServiceFn({
  publish: "read",
  title: "Get shifts list",
  output: z.array(
    rows.shift.pick({ id: true, name: true }).meta({ table: "shift" })
  ),
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

export const getEmployeeShifts = defineServiceFn({
  publish: "read",
  title: "Get employee shifts",
  output: z.array(
    rows.employeeShift
      .pick({ employeeId: true, shiftId: true })
      .meta({ table: "employeeShift" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getEmployeeShifts(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getEmployeeDepartments = defineServiceFn({
  publish: "read",
  title: "Get employee departments",
  output: z.array(
    z.object({
      id: z.string(),
      departmentId: z.string().nullable()
    })
  ),
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

export const getShiftsWithTimes = defineServiceFn({
  publish: "read",
  title: "Get shifts with times",
  output: z.array(
    rows.shift
      .pick({
        id: true,
        name: true,
        startTime: true,
        endTime: true,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: true
      })
      .meta({ table: "shift" })
  ),
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

export const insertAttribute = defineServiceFn({
  publish: true,
  title: "Insert attribute",
  output: z.object({
    id: z.string()
  }),
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

export const insertAttributeCategory = defineServiceFn({
  publish: true,
  title: "Insert attribute category",
  output: z.object({
    id: z.string()
  }),
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

export const insertEmployeeJob = defineServiceFn({
  publish: true,
  title: "Insert employee job",
  output: rows.employeeJob
    .pick({
      companyId: true,
      defaultStorageUnitId: true,
      departmentId: true,
      flsaStatus: true,
      id: true,
      isOfficer: true,
      laborCategoryId: true,
      locationId: true,
      managerId: true,
      shiftId: true,
      startDate: true,
      tags: true,
      timesheetRequired: true,
      title: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "employeeJob" }),
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

export const updateAttribute = defineServiceFn({
  publish: true,
  title: "Update attribute",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
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

export const updateAttributeCategory = defineServiceFn({
  publish: true,
  title: "Update attribute category",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
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

export const updateAttributeSortOrder = defineServiceFn({
  publish: true,
  title: "Update attribute sort order",
  output: z.array(z.null()),
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

export const createDepartment = defineServiceFn({
  publish: true,
  title: "Create a department",
  description: "Upsert department",
  output: rows.department
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      parentDepartmentId: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "department" }),
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

export const updateDepartment = defineServiceFn({
  publish: true,
  title: "Update a department",
  description: "Upsert department",
  output: rows.department
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      parentDepartmentId: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "department" }),
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

export const createHoliday = defineServiceFn({
  publish: true,
  title: "Create a holiday",
  description: "Upsert holiday",
  output: rows.holiday
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      date: true,
      id: true,
      name: true,
      tags: true,
      updatedAt: true,
      updatedBy: true,
      year: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "holiday" }),
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
    const saved = unwrap(
      ctx,
      await service.upsertHoliday(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
    if (saved instanceof CarbonError) return saved;
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "location",
      "Company holidays changed"
    );
    return saved;
  }
});

export const updateHoliday = defineServiceFn({
  publish: true,
  title: "Update a holiday",
  description: "Upsert holiday",
  output: rows.holiday
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      date: true,
      id: true,
      name: true,
      tags: true,
      updatedAt: true,
      updatedBy: true,
      year: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "holiday" }),
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
    const saved = unwrap(
      ctx,
      await service.upsertHoliday(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
    if (saved instanceof CarbonError) return saved;
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "location",
      "Company holidays changed"
    );
    return saved;
  }
});

export const createTimeCardEntry = defineServiceFn({
  publish: true,
  title: "Create time card entry",
  output: rows.timeCardEntry
    .pick({ id: true })
    .meta({ table: "timeCardEntry" }),
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

export const deleteTimeCardEntry = defineServiceFn({
  publish: "destructive",
  title: "Delete time card entry",
  output: z.array(
    rows.timeCardEntry.pick({ id: true }).meta({ table: "timeCardEntry" })
  ),
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

export const getOpenClockEntry = defineServiceFn({
  publish: "read",
  title: "Get open clock entry",
  output: rows.timeCardEntry,
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

export const getTimeCardEntry = defineServiceFn({
  publish: "read",
  title: "Get time card entry",
  output: rows.timeCardEntry,
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

export const getTimeCardEntries = defineServiceFn({
  publish: "read",
  title: "Get time card entries",
  output: z.array(rows.timeCardEntry),
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

export const getTimecardEntries = defineServiceFn({
  publish: "read",
  title: "Get timecard entries",
  output: z.array(rows.timeCardEntries).nullable(),
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

export const getPayrollPeriodTotals = defineServiceFn({
  publish: "read",
  title: "List the imported payroll totals",
  description: `One row per employee and pay period, from the payroll system's export:
the gross wages and the hours paid. Newest period first.`,
  output: z
    .array(
      rows.payrollPeriodTotal
        .pick({
          id: true,
          employeeId: true,
          periodStart: true,
          periodEnd: true,
          grossWages: true,
          hoursPaid: true,
          importedAt: true
        })
        .meta({ table: "payrollPeriodTotal" })
    )
    .nullable(),
  input: z.looseObject({
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
      await service.getPayrollPeriodTotals(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const updateTimeCardEntry = defineServiceFn({
  publish: true,
  title: "Update time card entry",
  output: z.array(
    rows.timeCardEntry.pick({ id: true }).meta({ table: "timeCardEntry" })
  ),
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
