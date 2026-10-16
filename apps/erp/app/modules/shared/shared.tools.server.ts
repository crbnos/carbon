// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The shared module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in shared.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  envelopes,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  deleteSavedView,
  getBase64ImageFromSupabase,
  getCountries,
  getCustomerPortal,
  getCustomerPortals,
  getEnforcementRule,
  getEnforcementRuleAssignmentCounts,
  getEnforcementRules,
  getExternalLink,
  getModelByItemId,
  getNotes,
  getTagsList,
  insertNote,
  insertTag,
  updateSavedViewOrder,
  upsertSavedView
} from "./shared.service";

/**
 * Delete saved view
 *
 * @mcp destructive
 */
export const deleteSavedViewTool = defineServiceFn({
  input: z.looseObject({ viewId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSavedView(ctx.asCaller.supabase, input.viewId as never)
    );
  }
});

/**
 * Get base64 image from supabase
 *
 * @mcp read
 */
export const getBase64ImageFromSupabaseTool = defineServiceFn({
  input: z.looseObject({ path: z.string() }),
  permission: {},
  async run(ctx, input) {
    return plain(
      ctx,
      await getBase64ImageFromSupabase(
        ctx.asCaller.supabase,
        input.path as never
      )
    );
  }
});

/**
 * Get countries
 *
 * @mcp read
 */
export const getCountriesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: {},
  async run(ctx) {
    return envelope(ctx, await getCountries(ctx.asCaller.supabase));
  }
});

/**
 * The item's CAD model in the same shape the line views expose it, so it drops straight into `<CadModel modelUpload={...} />`
 *
 * @mcp read
 */
export const getModelByItemIdTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return plain(
      ctx,
      await getModelByItemId(ctx.asCaller.supabase, input.itemId as never)
    );
  }
});

/**
 * Get notes
 *
 * @mcp read
 */
export const getNotesTool = defineServiceFn({
  input: z.looseObject({ documentId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getNotes(ctx.asCaller.supabase, input.documentId as never)
    );
  }
});

/**
 * Get tags list
 *
 * @mcp read
 */
export const getTagsListTool = defineServiceFn({
  input: z.looseObject({ table: z.string().nullable().optional() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTagsList(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.table as never
      )
    );
  }
});

/**
 * Insert note
 *
 * @mcp
 */
export const insertNoteTool = defineServiceFn({
  input: z.looseObject({ note: z.string(), documentId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertNote(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Insert tag
 *
 * @mcp
 */
export const insertTagTool = defineServiceFn({
  input: z.looseObject({
    tag: z.looseObject({
      createdAt: z.string().optional(),
      name: z.string(),
      table: z.string()
    })
  }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertTag(
        ctx.asCaller.supabase,
        stamp(ctx, input.tag, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get external link
 *
 * @mcp read
 */
export const getExternalLinkTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getExternalLink(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get customer portals
 *
 * @mcp read
 */
export const getCustomerPortalsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: {},
  async run(ctx, input) {
    return paged(
      ctx,
      await getCustomerPortals(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get customer portal
 *
 * @mcp read
 */
export const getCustomerPortalTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerPortal(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Upsert saved view
 *
 * @mcp
 */
export const upsertSavedViewTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    table: z.string(),
    type: z.enum(["Public", "Private"]),
    filters: z.array(z.string()).optional(),
    sorts: z.array(z.string()).optional(),
    columnPinning: z.record(z.string(), z.unknown()).optional(),
    columnVisibility: z.record(z.string(), z.unknown()).optional(),
    columnOrder: z.array(z.string()).optional()
  }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSavedView(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Update saved view order
 *
 * @mcp
 */
export const updateSavedViewOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: {},
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateSavedViewOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get enforcement rules
 *
 * @mcp read
 */
export const getEnforcementRulesTool = defineServiceFn({
  input: z.looseObject({
    family: z.enum(["storage", "sales"]),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional(),
      targetType: z.enum(["item", "workCenter"]).nullable().optional()
    })
  }),
  permission: {},
  async run(ctx, input) {
    return paged(
      ctx,
      await getEnforcementRules(
        ctx.asCaller.supabase,
        input.family as never,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get enforcement rule
 *
 * @mcp read
 */
export const getEnforcementRuleTool = defineServiceFn({
  input: z.looseObject({
    family: z.enum(["storage", "sales"]),
    id: z.string()
  }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEnforcementRule(
        ctx.asCaller.supabase,
        input.family as never,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Pin counts per rule id
 *
 * @mcp read
 */
export const getEnforcementRuleAssignmentCountsTool = defineServiceFn({
  input: z.looseObject({ ruleIds: z.array(z.string()) }),
  permission: {},
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEnforcementRuleAssignmentCounts(
        ctx.asCaller.supabase,
        stamp(ctx, input.ruleIds, ["companyId"]) as never
      )
    );
  }
});
