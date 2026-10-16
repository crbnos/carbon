// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The people module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in people.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  envelopes,
  paged,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  createTimeCardEntry,
  deleteAttribute,
  deleteAttributeCategory,
  deleteDepartment,
  deleteHoliday,
  deleteShift,
  deleteTimeCardEntry,
  getAttribute,
  getAttributeCategories,
  getAttributeCategory,
  getAttributeDataTypes,
  getDepartment,
  getDepartmentsList,
  getDepartmentsTree,
  getEmployeeDepartments,
  getEmployeeJob,
  getEmployeeShifts,
  getEmployeeSummary,
  getHoliday,
  getHolidays,
  getHolidayYears,
  getOpenClockEntry,
  getPeople,
  getShift,
  getShifts,
  getShiftsList,
  getShiftsWithTimes,
  getTimeCardEntries,
  getTimeCardEntry,
  getTimecardEntries,
  insertAttribute,
  insertAttributeCategory,
  insertEmployeeJob,
  updateAttribute,
  updateAttributeCategory,
  updateAttributeSortOrder,
  updateTimeCardEntry,
  upsertDepartment,
  upsertHoliday
} from "./people.service";

/**
 * Delete attribute
 *
 * @mcp destructive
 */
export const deleteAttributeTool = defineServiceFn({
  input: z.looseObject({ attributeId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAttribute(ctx.asCaller.supabase, input.attributeId as never)
    );
  }
});

/**
 * Delete attribute category
 *
 * @mcp destructive
 */
export const deleteAttributeCategoryTool = defineServiceFn({
  input: z.looseObject({ attributeCategoryId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAttributeCategory(
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
export const deleteDepartmentTool = defineServiceFn({
  input: z.looseObject({ departmentId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteDepartment(ctx.asCaller.supabase, input.departmentId as never)
    );
  }
});

/**
 * Delete holiday
 *
 * @mcp destructive
 */
export const deleteHolidayTool = defineServiceFn({
  input: z.looseObject({ holidayId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteHoliday(ctx.asCaller.supabase, input.holidayId as never)
    );
  }
});

/**
 * Delete shift
 *
 * @mcp destructive
 */
export const deleteShiftTool = defineServiceFn({
  input: z.looseObject({ shiftId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteShift(ctx.asCaller.supabase, input.shiftId as never)
    );
  }
});

/**
 * Get attribute
 *
 * @mcp read
 */
export const getAttributeTool = defineServiceFn({
  input: z.looseObject({ attributeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAttribute(ctx.asCaller.supabase, input.attributeId as never)
    );
  }
});

/**
 * Get attribute categories
 *
 * @mcp read
 */
export const getAttributeCategoriesTool = defineServiceFn({
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
      await getAttributeCategories(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get attribute category
 *
 * @mcp read
 */
export const getAttributeCategoryTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAttributeCategory(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get attribute data types
 *
 * @mcp read
 */
export const getAttributeDataTypesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return envelope(ctx, await getAttributeDataTypes(ctx.asCaller.supabase));
  }
});

/**
 * Get department
 *
 * @mcp read
 */
export const getDepartmentTool = defineServiceFn({
  input: z.looseObject({ departmentId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDepartment(ctx.asCaller.supabase, input.departmentId as never)
    );
  }
});

/**
 * Get departments list
 *
 * @mcp read
 */
export const getDepartmentsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return envelope(
      ctx,
      await getDepartmentsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get departments tree
 *
 * @mcp read
 */
export const getDepartmentsTreeTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return envelope(
      ctx,
      await getDepartmentsTree(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get employee job
 *
 * @mcp read
 */
export const getEmployeeJobTool = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEmployeeJob(
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
export const getEmployeeSummaryTool = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEmployeeSummary(
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
export const getHolidayTool = defineServiceFn({
  input: z.looseObject({ holidayId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getHoliday(ctx.asCaller.supabase, input.holidayId as never)
    );
  }
});

/**
 * Get holidays
 *
 * @mcp read
 */
export const getHolidaysTool = defineServiceFn({
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
      await getHolidays(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get holiday years
 *
 * @mcp read
 */
export const getHolidayYearsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return envelope(
      ctx,
      await getHolidayYears(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get people
 *
 * @mcp read
 */
export const getPeopleTool = defineServiceFn({
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
    return envelope(
      ctx,
      await getPeople(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get shift
 *
 * @mcp read
 */
export const getShiftTool = defineServiceFn({
  input: z.looseObject({ shiftId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShift(ctx.asCaller.supabase, input.shiftId as never)
    );
  }
});

/**
 * Get shifts
 *
 * @mcp read
 */
export const getShiftsTool = defineServiceFn({
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
      await getShifts(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get shifts list
 *
 * @mcp read
 */
export const getShiftsListTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string().nullable() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShiftsList(
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
export const getEmployeeShiftsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return envelope(
      ctx,
      await getEmployeeShifts(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get employee departments
 *
 * @mcp read
 */
export const getEmployeeDepartmentsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "people" },
  async run(ctx) {
    return envelope(
      ctx,
      await getEmployeeDepartments(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get shifts with times
 *
 * @mcp read
 */
export const getShiftsWithTimesTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShiftsWithTimes(
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
export const insertAttributeTool = defineServiceFn({
  input: z.looseObject({
    name: z.string(),
    attributeDataTypeId: z.number(),
    userAttributeCategoryId: z.string(),
    listOptions: z.array(z.string()).optional(),
    canSelfManage: z.boolean()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertAttribute(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Insert attribute category
 *
 * @mcp
 */
export const insertAttributeCategoryTool = defineServiceFn({
  input: z.looseObject({
    name: z.string(),
    emoji: z.string().optional(),
    public: z.boolean()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertAttributeCategory(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Insert employee job
 *
 * @mcp
 */
export const insertEmployeeJobTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), locationId: z.string() }),
  permission: { create: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertEmployeeJob(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update attribute
 *
 * @mcp
 */
export const updateAttributeTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    listOptions: z.array(z.string()).optional(),
    canSelfManage: z.boolean()
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateAttribute(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update attribute category
 *
 * @mcp
 */
export const updateAttributeCategoryTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    name: z.string(),
    emoji: z.string().optional(),
    public: z.boolean()
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateAttributeCategory(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update attribute sort order
 *
 * @mcp
 */
export const updateAttributeSortOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateAttributeSortOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
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
export const upsertDepartmentCreateTool = defineServiceFn({
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
    return envelope(
      ctx,
      await upsertDepartment(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
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
export const upsertDepartmentUpdateTool = defineServiceFn({
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
    return envelope(
      ctx,
      await upsertDepartment(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
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
export const upsertHolidayCreateTool = defineServiceFn({
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
    return envelope(
      ctx,
      await upsertHoliday(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
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
export const upsertHolidayUpdateTool = defineServiceFn({
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
    return envelope(
      ctx,
      await upsertHoliday(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create time card entry
 *
 * @mcp
 */
export const createTimeCardEntryTool = defineServiceFn({
  input: z.looseObject({
    employeeId: z.string(),
    clockIn: z.string(),
    clockOut: z.string().nullable().optional(),
    note: z.string().nullable().optional()
  }),
  permission: { create: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createTimeCardEntry(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete time card entry
 *
 * @mcp destructive
 */
export const deleteTimeCardEntryTool = defineServiceFn({
  input: z.looseObject({ entryId: z.string() }),
  permission: { delete: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteTimeCardEntry(ctx.asCaller.supabase, input.entryId as never)
    );
  }
});

/**
 * Get open clock entry
 *
 * @mcp read
 */
export const getOpenClockEntryTool = defineServiceFn({
  input: z.looseObject({ employeeId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenClockEntry(
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
export const getTimeCardEntryTool = defineServiceFn({
  input: z.looseObject({ entryId: z.string() }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTimeCardEntry(ctx.asCaller.supabase, input.entryId as never)
    );
  }
});

/**
 * Get time card entries
 *
 * @mcp read
 */
export const getTimeCardEntriesTool = defineServiceFn({
  input: z.looseObject({
    employeeId: z.string(),
    from: z.string().optional(),
    to: z.string().optional()
  }),
  permission: { view: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTimeCardEntries(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get timecard entries
 *
 * @mcp read
 */
export const getTimecardEntriesTool = defineServiceFn({
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
      await getTimecardEntries(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Update time card entry
 *
 * @mcp
 */
export const updateTimeCardEntryTool = defineServiceFn({
  input: z.looseObject({
    entryId: z.string(),
    clockIn: z.string().optional(),
    clockOut: z.string().nullable().optional(),
    note: z.string().nullable().optional()
  }),
  permission: { update: "people" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateTimeCardEntry(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});
