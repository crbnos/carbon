// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The account module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in account.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { envelope, stamp } from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  getAccount,
  getAllAttributeCategories,
  getAttributeCategoryWithValues,
  getCurrentUser,
  getNotificationPreferences,
  updatePublicAccount,
  upsertNotificationPreference
} from "./account.service";

/**
 * Get notification preferences
 *
 * @mcp read
 */
export const getNotificationPreferencesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: {},
  async run(ctx) {
    return envelope(
      ctx,
      await getNotificationPreferences(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert notification preference
 *
 * @mcp
 */
export const upsertNotificationPreferenceTool = defineServiceFn({
  input: z.looseObject({
    topic: z.string(),
    channel: z.enum(["email", "slack"]),
    enabled: z.boolean()
  }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertNotificationPreference(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Get account
 *
 * @mcp read
 */
export const getAccountTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccount(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Return the connected user's own profile (id, email, name)
 *
 * @mcp read
 */
export const getCurrentUserTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: {},
  async run(ctx) {
    return envelope(
      ctx,
      await getCurrentUser(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * Get all attribute categories
 *
 * @mcp read
 */
export const getAllAttributeCategoriesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: {},
  async run(ctx) {
    return envelope(
      ctx,
      await getAllAttributeCategories(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get attribute category with values
 *
 * @mcp read
 */
export const getAttributeCategoryWithValuesTool = defineServiceFn({
  input: z.looseObject({ categoryId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAttributeCategoryWithValues(
        ctx.asCaller.supabase,
        input.categoryId as never,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Update public account
 *
 * @mcp
 */
export const updatePublicAccountTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    about: z.string().optional(),
    phone: z.string().optional()
  }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePublicAccount(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});
