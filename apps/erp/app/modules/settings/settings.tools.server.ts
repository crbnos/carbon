// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The settings module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in settings.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  deleteItemSerialSequence,
  getAccountsPayableBillingAddress,
  getAccountsReceivableBillingAddress,
  getApiKeys,
  getCompanies,
  getCompany,
  getCompanySettings,
  getConfig,
  getCurrentSequence,
  getCustomField,
  getCustomFields,
  getCustomFieldsTables,
  getDocumentSections,
  getDocumentTemplate,
  getDocumentTemplateConfig,
  getEmployeeCompanies,
  getIndustries,
  getIntegration,
  getItemSerialSequence,
  getItemSerialSequences,
  getKanbanOutputSetting,
  getNextSequence,
  getPlans,
  getSequence,
  getSequences,
  getSequencesList,
  getSubsidiaries,
  getSubsidiary,
  getTerms,
  getWebhook,
  getWebhooks,
  getWebhookTables,
  resolveSections,
  updateSequence,
  upsertItemSerialSequence
} from "./settings.service";

/**
 * Get accounts payable billing address
 *
 * @mcp read
 */
export const getAccountsPayableBillingAddressTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getAccountsPayableBillingAddress(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get accounts receivable billing address
 *
 * @mcp read
 */
export const getAccountsReceivableBillingAddressTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getAccountsReceivableBillingAddress(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get api keys
 *
 * @mcp read
 */
export const getApiKeysTool = defineServiceFn({
  input: z.looseObject({
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { update: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getApiKeys(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.args ?? {}, ["companyId"]) as never
      )
    );
  }
});

/**
 * The view already carries `companyGroupName`, so there is nothing to embed
 *
 * @mcp read
 */
export const getCompaniesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCompanies(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * The companies a user can enter in the ERP
 *
 * @mcp read
 */
export const getEmployeeCompaniesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getEmployeeCompanies(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * Get industries
 *
 * @mcp read
 */
export const getIndustriesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(ctx, await getIndustries(ctx.asCaller.supabase));
  }
});

/**
 * Get company
 *
 * @mcp read
 */
export const getCompanyTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCompany(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get company settings
 *
 * @mcp read
 */
export const getCompanySettingsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCompanySettings(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get config
 *
 * @mcp read
 */
export const getConfigTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(ctx, await getConfig(ctx.asCaller.supabase));
  }
});

/**
 * Get current sequence
 *
 * @mcp read
 */
export const getCurrentSequenceTool = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCurrentSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get custom field
 *
 * @mcp read
 */
export const getCustomFieldTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomField(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get custom fields
 *
 * @mcp read
 */
export const getCustomFieldsTool = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomFields(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get custom fields tables
 *
 * @mcp read
 */
export const getCustomFieldsTablesTool = defineServiceFn({
  input: z.looseObject({
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getCustomFieldsTables(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.args ?? {}, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get integration
 *
 * @mcp read
 */
export const getIntegrationTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getIntegration(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get kanban output setting
 *
 * @mcp read
 */
export const getKanbanOutputSettingTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getKanbanOutputSetting(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Takes the next number of a sequence, which advances it
 *
 * @mcp
 */
export const getNextSequenceTool = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getNextSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get plans
 *
 * @mcp read
 */
export const getPlansTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(ctx, await getPlans(ctx.asCaller.supabase));
  }
});

/**
 * Get sequence
 *
 * @mcp read
 */
export const getSequenceTool = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sequences
 *
 * @mcp read
 */
export const getSequencesTool = defineServiceFn({
  input: z.looseObject({
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSequences(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.args ?? {}, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get sequences list
 *
 * @mcp read
 */
export const getSequencesListTool = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSequencesList(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item serial sequences
 *
 * @mcp read
 */
export const getItemSerialSequencesTool = defineServiceFn({
  input: z.looseObject({
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getItemSerialSequences(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.args ?? {}, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get item serial sequence
 *
 * @mcp read
 */
export const getItemSerialSequenceTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemSerialSequence(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a item serial sequence
 *
 * @remarks
 * Upsert item serial sequence
 *
 * @mcp
 */
export const upsertItemSerialSequenceCreateTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    next: z.number().min(0),
    step: z.number().min(1),
    size: z.number().min(1).max(20),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemSerialSequence(
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
 * Update a item serial sequence
 *
 * @remarks
 * Upsert item serial sequence
 *
 * @mcp
 */
export const upsertItemSerialSequenceUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      itemId: z.string().min(1),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
      next: z.number().min(0),
      step: z.number().min(1),
      size: z.number().min(1).max(20),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemSerialSequence(
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
 * Delete item serial sequence
 *
 * @mcp destructive
 */
export const deleteItemSerialSequenceTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteItemSerialSequence(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get subsidiaries
 *
 * @mcp read
 */
export const getSubsidiariesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getSubsidiaries(ctx.asCaller.supabase, ctx.company.groupId)
    );
  }
});

/**
 * Get subsidiary
 *
 * @mcp read
 */
export const getSubsidiaryTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getSubsidiary(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get terms
 *
 * @mcp read
 */
export const getTermsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(ctx, await getTerms(ctx.asCaller.supabase, ctx.company.id));
  }
});

/**
 * Get document template
 *
 * @mcp read
 */
export const getDocumentTemplateTool = defineServiceFn({
  input: z.looseObject({
    documentType: z.enum([
      "purchaseOrder",
      "salesOrder",
      "stockTransfer",
      "salesInvoice",
      "quote",
      "purchaseReturnOrder",
      "salesReturnOrder",
      "issue",
      "packingSlip",
      "jobTraveler",
      "trackingLabel"
    ])
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDocumentTemplate(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.documentType as never
      )
    );
  }
});

/**
 * Load a stored document template as a `DocumentTemplate | null` ready to pass to a PDF (which runs it through `resolveTemplate`)
 *
 * @mcp read
 */
export const getDocumentTemplateConfigTool = defineServiceFn({
  input: z.looseObject({
    documentType: z.enum([
      "purchaseOrder",
      "salesOrder",
      "stockTransfer",
      "salesInvoice",
      "quote",
      "purchaseReturnOrder",
      "salesReturnOrder",
      "issue",
      "packingSlip",
      "jobTraveler",
      "trackingLabel"
    ])
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getDocumentTemplateConfig(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.documentType as never
      )
    );
  }
});

/**
 * Get document sections
 *
 * @mcp read
 */
export const getDocumentSectionsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(
      ctx,
      await getDocumentSections(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Fetch the given section ids and return them keyed by id for rendering
 *
 * @mcp
 */
export const resolveSectionsTool = defineServiceFn({
  input: z.looseObject({ ids: z.array(z.string()) }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return plain(
      ctx,
      await resolveSections(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.ids, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get webhook
 *
 * @mcp read
 */
export const getWebhookTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWebhook(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get webhooks
 *
 * @mcp read
 */
export const getWebhooksTool = defineServiceFn({
  input: z.looseObject({
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getWebhooks(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.args ?? {}, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get webhook tables
 *
 * @mcp read
 */
export const getWebhookTablesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return envelope(ctx, await getWebhookTables(ctx.asCaller.supabase));
  }
});

/**
 * Update sequence
 *
 * @mcp
 */
export const updateSequenceTool = defineServiceFn({
  input: z.looseObject({
    table: z.string(),
    sequence: z.looseObject({
      table: z.string().min(1).optional(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
      next: z.number().min(0).optional(),
      step: z.number().min(1).optional(),
      size: z.number().min(1).max(20).optional()
    })
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id,
        stamp(ctx, input.sequence, ["companyId", "updatedBy"]) as never
      )
    );
  }
});
