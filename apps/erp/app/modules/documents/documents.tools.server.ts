// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The documents module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in documents.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { envelope, paged, stamp } from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  createDocumentUploadUrl,
  deleteDocument,
  getDocument,
  getDocumentExtensions,
  getDocumentLabels,
  getDocuments,
  insertDocumentExtraction,
  insertUploadedDocument,
  moveDocumentToTrash,
  restoreDocument,
  updateDocumentFavorite,
  updateDocumentLabels,
  upsertDocument
} from "./documents.service";

/**
 * Delete document
 *
 * @mcp destructive
 */
export const deleteDocumentTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteDocument(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get document
 *
 * @mcp read
 */
export const getDocumentTool = defineServiceFn({
  input: z.looseObject({ documentId: z.string() }),
  permission: { view: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDocument(ctx.asCaller.supabase, input.documentId as never)
    );
  }
});

/**
 * Get documents
 *
 * @mcp read
 */
export const getDocumentsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    favorite: z.boolean().optional(),
    recent: z.boolean().optional(),
    active: z.boolean()
  }),
  permission: { view: "documents" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get document extensions
 *
 * @mcp read
 */
export const getDocumentExtensionsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "documents" },
  async run(ctx) {
    return envelope(
      ctx,
      await getDocumentExtensions(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get document labels
 *
 * @mcp read
 */
export const getDocumentLabelsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "documents" },
  async run(ctx) {
    return envelope(
      ctx,
      await getDocumentLabels(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * Move document to trash
 *
 * @mcp
 */
export const moveDocumentToTrashTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await moveDocumentToTrash(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Restore document
 *
 * @mcp
 */
export const restoreDocumentTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await restoreDocument(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Create a document
 *
 * @remarks
 * Upsert document
 *
 * @mcp
 */
export const upsertDocumentCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(3).max(50),
    extension: z.string().optional(),
    description: z.string().optional(),
    labels: z.array(z.string().min(1).max(50)).optional(),
    readGroups: z.array(z.string().min(1)).min(1),
    writeGroups: z.array(z.string().min(1)).min(1),
    path: z.string().optional(),
    size: z.number().optional(),
    sourceDocument: z
      .enum([
        "Job",
        "Gauge Calibration Record",
        "Issue",
        "Purchase Order",
        "Purchase Invoice",
        "Quote",
        "Request for Quote",
        "Purchasing Request for Quote",
        "Supplier Quote",
        "Sales Order",
        "Sales Invoice",
        "Sales Return Order",
        "Purchase Return Order",
        "Shipment",
        "Supplier",
        "Customer",
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service"
      ])
      .optional(),
    sourceDocumentId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertDocument(
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
 * Update a document
 *
 * @remarks
 * Upsert document
 *
 * @mcp
 */
export const upsertDocumentUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(3).max(50),
      extension: z.string().optional(),
      description: z.string().optional(),
      labels: z.array(z.string().min(1).max(50)).optional(),
      readGroups: z.array(z.string().min(1)).min(1),
      writeGroups: z.array(z.string().min(1)).min(1),
      path: z.string().optional(),
      size: z.number().optional(),
      sourceDocument: z
        .enum([
          "Job",
          "Gauge Calibration Record",
          "Issue",
          "Purchase Order",
          "Purchase Invoice",
          "Quote",
          "Request for Quote",
          "Purchasing Request for Quote",
          "Supplier Quote",
          "Sales Order",
          "Sales Invoice",
          "Sales Return Order",
          "Purchase Return Order",
          "Shipment",
          "Supplier",
          "Customer",
          "Part",
          "Material",
          "Tool",
          "Consumable",
          "Service"
        ])
        .optional(),
      sourceDocumentId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertDocument(
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
 * Create a presigned upload URL for a document in the "private" bucket
 *
 * @mcp
 */
export const createDocumentUploadUrlTool = defineServiceFn({
  input: z.looseObject({
    folder: z.string(),
    entityId: z.string(),
    name: z.string()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createDocumentUploadUrl(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Register the metadata row for a file already uploaded to storage
 *
 * @mcp
 */
export const insertUploadedDocumentTool = defineServiceFn({
  input: z.looseObject({
    path: z.string(),
    name: z.string(),
    size: z.number(),
    sourceDocument: z
      .enum([
        "Job",
        "Gauge Calibration Record",
        "Issue",
        "Purchase Order",
        "Purchase Invoice",
        "Quote",
        "Request for Quote",
        "Purchasing Request for Quote",
        "Supplier Quote",
        "Sales Order",
        "Sales Invoice",
        "Sales Return Order",
        "Purchase Return Order",
        "Shipment",
        "Supplier",
        "Customer",
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service"
      ])
      .optional(),
    sourceDocumentId: z.string().optional()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertUploadedDocument(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update document favorite
 *
 * @mcp destructive
 */
export const updateDocumentFavoriteTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), favorite: z.boolean() }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateDocumentFavorite(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Update document labels
 *
 * @mcp destructive
 */
export const updateDocumentLabelsTool = defineServiceFn({
  input: z.looseObject({
    documentId: z.string().min(20),
    labels: z.array(z.string().min(1).max(50)).optional()
  }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateDocumentLabels(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Insert document extraction
 *
 * @mcp
 */
export const insertDocumentExtractionTool = defineServiceFn({
  input: z.looseObject({
    storagePath: z.string(),
    documentType: z.enum(["purchaseInvoice", "salesRfq"]),
    sourceDocument: z.string(),
    sourceDocumentId: z.string().optional()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertDocumentExtraction(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});
