// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The users module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in users.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  deleteGroup,
  getConsoleOperators,
  getCustomers,
  getEmployee,
  getEmployees,
  getEmployeeType,
  getEmployeeTypes,
  getGroup,
  getGroupEmails,
  getGroupMembers,
  getGroups,
  getInvitable,
  getItarCertificationReport,
  getItarCertificationStatus,
  getItarEntityCertification,
  getModules,
  getPermissionsByEmployeeType,
  getSuppliers,
  getUnrevokedInviteEmails,
  getUserSelectGroupMembers,
  getUserSelectGroups,
  getUsersWithVerifiedMfa,
  resolveUserSelectIds,
  searchUsersForSelect
} from "./users.service";

/**
 * The ITAR gate: does a valid, unexpired entity Rider acceptance exist for this company, and a valid user attestation for this user
 *
 * @mcp read
 */
export const getItarCertificationStatusTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
  async run(ctx) {
    return plain(
      ctx,
      await getItarCertificationStatus(
        ctx.asCaller.supabase,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * The company's latest entity Rider acceptance, or null when nobody has accepted one yet
 *
 * @mcp read
 */
export const getItarEntityCertificationTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
  async run(ctx) {
    return envelope(
      ctx,
      await getItarEntityCertification(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Compliance report source: every active employee with their latest ITAR certification (version / date / expiry)
 *
 * @mcp read
 */
export const getItarCertificationReportTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
  async run(ctx) {
    return envelope(
      ctx,
      await getItarCertificationReport(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Delete group
 *
 * @mcp destructive
 */
export const deleteGroupTool = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { delete: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteGroup(ctx.asCaller.supabase, input.groupId as never)
    );
  }
});

/**
 * Get customers
 *
 * @mcp read
 */
export const getCustomersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getCustomers(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get employee
 *
 * @mcp read
 */
export const getEmployeeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEmployee(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get unrevoked invite emails
 *
 * @mcp read
 */
export const getUnrevokedInviteEmailsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
  async run(ctx) {
    return envelope(
      ctx,
      await getUnrevokedInviteEmails(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * User ids in this company with a verified authenticator
 *
 * @mcp read
 */
export const getUsersWithVerifiedMfaTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
  async run(ctx) {
    return envelope(
      ctx,
      await getUsersWithVerifiedMfa(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get employees
 *
 * @mcp read
 */
export const getEmployeesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getEmployees(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Gets console operators — users with @console.internal emails
 *
 * @mcp read
 */
export const getConsoleOperatorsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getConsoleOperators(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get employee type
 *
 * @mcp read
 */
export const getEmployeeTypeTool = defineServiceFn({
  input: z.looseObject({ employeeTypeId: z.string() }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEmployeeType(
        ctx.asCaller.supabase,
        input.employeeTypeId as never
      )
    );
  }
});

/**
 * Get employee types
 *
 * @mcp read
 */
export const getEmployeeTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getEmployeeTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get invitable
 *
 * @mcp read
 */
export const getInvitableTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
  async run(ctx) {
    return envelope(
      ctx,
      await getInvitable(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get modules
 *
 * @mcp read
 */
export const getModulesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
  async run(ctx) {
    return envelope(ctx, await getModules(ctx.asCaller.supabase));
  }
});

/**
 * Get group
 *
 * @mcp read
 */
export const getGroupTool = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getGroup(ctx.asCaller.supabase, input.groupId as never)
    );
  }
});

/**
 * Get group members
 *
 * @mcp read
 */
export const getGroupMembersTool = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getGroupMembers(ctx.asCaller.supabase, input.groupId as never)
    );
  }
});

/**
 * Get groups
 *
 * @mcp read
 */
export const getGroupsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    uid: z.string().nullable().optional()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getGroups(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get group emails
 *
 * @mcp read
 */
export const getGroupEmailsTool = defineServiceFn({
  input: z.looseObject({ groupIds: z.array(z.string()) }),
  permission: { view: "users" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getGroupEmails(
        ctx.asCaller.supabase,
        stamp(ctx, input.groupIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get user select groups
 *
 * @mcp read
 */
export const getUserSelectGroupsTool = defineServiceFn({
  input: z.looseObject({
    type: z.string().optional(),
    search: z.string().optional(),
    limit: z.number(),
    offset: z.number()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getUserSelectGroups(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get user select group members
 *
 * @mcp read
 */
export const getUserSelectGroupMembersTool = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getUserSelectGroupMembers(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.groupId as never
      )
    );
  }
});

/**
 * Search users for select
 *
 * @mcp read
 */
export const searchUsersForSelectTool = defineServiceFn({
  input: z.looseObject({
    q: z.string(),
    type: z.string().optional(),
    excludeSelf: z.boolean().optional(),
    allowedIds: z.array(z.string()).optional()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await searchUsersForSelect(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Resolve user select ids
 *
 * @mcp
 */
export const resolveUserSelectIdsTool = defineServiceFn({
  input: z.looseObject({ ids: z.array(z.string()) }),
  permission: { update: "users" },
  async run(ctx, input) {
    return plain(
      ctx,
      await resolveUserSelectIds(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.ids, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get permissions by employee type
 *
 * @mcp read
 */
export const getPermissionsByEmployeeTypeTool = defineServiceFn({
  input: z.looseObject({ employeeTypeId: z.string() }),
  permission: { view: "users" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPermissionsByEmployeeType(
        ctx.asCaller.supabase,
        input.employeeTypeId as never
      )
    );
  }
});

/**
 * Get suppliers
 *
 * @mcp read
 */
export const getSuppliersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSuppliers(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});
