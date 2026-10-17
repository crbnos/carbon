// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { z } from "zod";
import { refuseUnlessOwned } from "~/modules/shared/shared.service";
import { modelViewDirection } from "./documents.models";
import * as service from "./documents.service";

const logger = getLogger("erp", "documents");
/**
 * Render a model's preview thumbnail again.
 *
 * @remarks
 * The model must be the company's. `direction` is the viewer's camera (model
 * towards camera, Z up); without it the home view is drawn. Any employee may
 * ask: a preview is part of viewing, not part editing. A part's own thumbnail
 * hides the model's, so the call clears it on every part using the model.
 * That replaces the part's thumbnail, which needs permission to update parts;
 * without it the call is refused. The render writes the model's new
 * `thumbnailPath` when it lands.
 */
export const regenerateModelThumbnail = defineServiceFn({
  input: z.object({
    modelUploadId: z.string().min(1),
    direction: modelViewDirection.optional()
  }),
  permission: {},

  async run(ctx, { modelUploadId, direction }) {
    const missing = await service.findModel(ctx, modelUploadId);
    if (missing) return missing;
    const companyId = ctx.company.id;

    // `get_part_details` prefers `item.thumbnailPath` over the model's, so a
    // part's own thumbnail would mask the new render and come back on reload.
    const owned = await ctx.asCaller.supabase
      .from("item")
      .select("id")
      .eq("modelUploadId", modelUploadId)
      .eq("companyId", companyId)
      .not("thumbnailPath", "is", null)
      .limit(1);
    if (owned.error) {
      return ctx.error("internal", "Failed to read the parts", owned.error);
    }
    if (owned.data.length > 0) {
      if (!ctx.can({ update: "parts" })) {
        return ctx.error(
          "forbidden",
          "Replacing a part's thumbnail needs permission to update parts"
        );
      }
      const cleared = await ctx.asCaller.supabase
        .from("item")
        .update({ thumbnailPath: null })
        .eq("modelUploadId", modelUploadId)
        .eq("companyId", companyId);
      if (cleared.error) {
        return ctx.error(
          "internal",
          "Failed to clear the part's thumbnail",
          cleared.error
        );
      }
    }

    await trigger("model-thumbnail", {
      modelId: modelUploadId,
      companyId,
      ...(direction && { direction })
    });
    return { modelUploadId };
  }
});

/**
 * Optimise an uploaded model again.
 *
 * @remarks
 * The model must be the company's. The raw file still sits in storage, so
 * nothing is uploaded again. Backs the viewer's Retry (a model with no GLB)
 * and its refresh (`force`): the job skips a model that already optimised,
 * so `force` first resets its status to Queued. The current GLB stays until
 * the new one replaces it. Any employee may ask: the preview optimises on
 * view.
 */
export const optimizeModel = defineServiceFn({
  input: z.object({
    modelUploadId: z.string().min(1),
    force: z.boolean().optional()
  }),
  permission: {},

  async run(ctx, { modelUploadId, force = false }) {
    const missing = await service.findModel(ctx, modelUploadId);
    if (missing) return missing;
    const companyId = ctx.company.id;

    if (force) {
      const reset = await ctx.asSystem.supabase
        .from("modelUpload")
        // `updatedAt` too: the stuck-job cleanup reads it, and an old one
        // would mark this live run interrupted.
        .update({
          optimizeStatus: "Queued",
          optimizeError: null,
          updatedAt: datetime.timestamp()
        })
        .eq("id", modelUploadId)
        .eq("companyId", companyId);
      if (reset.error) {
        logger.error("Failed to reset the model's optimise status", {
          modelUploadId,
          error: reset.error
        });
      }
    }

    await trigger("model-optimize", {
      modelUploadId,
      companyId,
      userId: ctx.auditUserId,
      force
    });
    return { modelUploadId };
  }
});

/**
 * Cancel a model's optimisation.
 *
 * @remarks
 * The model must be the company's. A Queued or Processing optimise is marked
 * Failed ("Cancelled by user"), so the viewer settles at once; any other
 * status is left as it is and `cancelled` is false. The assembler's job is
 * then cancelled (best effort): its completion callback fails the waiting
 * run instead of letting it overwrite the row later. Any employee may cancel:
 * the preview is part of viewing.
 */
export const cancelModelOptimize = defineServiceFn({
  input: z.object({ modelUploadId: z.string().min(1) }),
  permission: {},

  async run(ctx, { modelUploadId }) {
    const missing = await service.findModel(ctx, modelUploadId);
    if (missing) return missing;

    // The service role: the RLS UPDATE policy needs an edit permission, and a
    // viewer's cancel would otherwise match no row (the spinner spins on).
    const cancelled = await ctx.asSystem.supabase
      .from("modelUpload")
      .update({ optimizeStatus: "Failed", optimizeError: "Cancelled by user" })
      .eq("id", modelUploadId)
      .eq("companyId", ctx.company.id)
      .in("optimizeStatus", ["Queued", "Processing"])
      .select("id");
    if (cancelled.error) {
      return ctx.error(
        "internal",
        "Failed to cancel the optimisation",
        cancelled.error
      );
    }

    // The optimise job id is `optimize-<modelUploadId>`, so no run lookup.
    if (ASSEMBLER_SERVICE_URL && cancelled.data.length > 0) {
      await fetch(
        `${ASSEMBLER_SERVICE_URL}/v1/jobs/optimize-${modelUploadId}/cancel`,
        {
          method: "POST",
          headers: ASSEMBLER_SERVICE_API_KEY
            ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
            : {},
          signal: AbortSignal.timeout(5000)
        }
      ).catch(() => {
        // The row is already Failed. A missed cancel only means the compute
        // finishes and flips it to Success, and that artifact is real.
      });
    }

    return { cancelled: cancelled.data.length > 0 };
  }
});

/**
 * Record that the user acting downloaded a document.
 *
 * @remarks
 * Writes the document's "Download" transaction, the same history the document
 * page writes. The document must be the company's. For a caller with no
 * session (a signed download link): the link's own check already proved the
 * user may read the document.
 */
export const recordDocumentDownload = defineServiceFn({
  input: z.object({ documentId: z.string().min(1) }),
  permission: "system",

  async run(ctx, { documentId }) {
    const notOwned = await refuseUnlessOwned(ctx, "document", {
      id: documentId
    });
    if (notOwned) return notOwned;

    const recorded = await ctx.asSystem.supabase
      .from("documentTransaction")
      .insert({
        documentId,
        type: "Download",
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    if (recorded.error) {
      return ctx.error(
        "internal",
        "Failed to record the download",
        recorded.error
      );
    }
    return { documentId };
  }
});
/**
 * Delete document
 *
 * @mcp destructive
 */
export const deleteDocument = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "documents" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteDocument(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get document
 *
 * @mcp read
 */
export const getDocument = defineServiceFn({
  input: z.looseObject({ documentId: z.string() }),
  permission: { view: "documents" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDocument(
        ctx.asCaller.supabase,
        input.documentId as never
      )
    );
  }
});

/**
 * Get documents
 *
 * @mcp read
 */
export const getDocuments = defineServiceFn({
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
      await service.getDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get document extensions
 *
 * @mcp read
 */
export const getDocumentExtensions = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "documents" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDocumentExtensions(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get document labels
 *
 * @mcp read
 */
export const getDocumentLabels = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "documents" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDocumentLabels(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * Move document to trash
 *
 * @mcp
 */
export const moveDocumentToTrash = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.moveDocumentToTrash(
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
export const restoreDocument = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.restoreDocument(
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
 * Records the document row for a file. To change an existing document, use
 * `documents_updateDocument`.
 *
 * @mcp
 */
export const createDocument = defineServiceFn({
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
    sourceDocumentId: z.string().optional()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    const foreign = service.refuseForeignPath(ctx, input.path);
    if (foreign) return foreign;
    return unwrap(
      ctx,
      await service.upsertDocument(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a document
 *
 * @remarks
 * Changes the document with this `id`.
 *
 * @mcp
 */
export const updateDocument = defineServiceFn({
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
      id: z.string().describe("The document to update.").optional()
    })
    .required({ id: true }),
  permission: { update: "documents" },
  async run(ctx, input) {
    const foreign = service.refuseForeignPath(ctx, input.path);
    if (foreign) return foreign;
    return unwrap(
      ctx,
      await service.upsertDocument(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for a document in the "private" bucket
 *
 * @mcp
 */
export const createDocumentUploadUrl = defineServiceFn({
  input: z.looseObject({
    folder: z.string(),
    entityId: z.string(),
    name: z.string()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createDocumentUploadUrl(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Register the metadata row for a file already uploaded to storage
 *
 * @mcp
 */
export const insertUploadedDocument = defineServiceFn({
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
    const foreign = service.refuseForeignPath(ctx, input.path);
    if (foreign) return foreign;
    return unwrap(
      ctx,
      await service.insertUploadedDocument(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update document favorite
 *
 * @mcp destructive
 */
export const updateDocumentFavorite = defineServiceFn({
  input: z.looseObject({ id: z.string(), favorite: z.boolean() }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateDocumentFavorite(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});

/**
 * Update document labels
 *
 * @mcp destructive
 */
export const updateDocumentLabels = defineServiceFn({
  input: z.looseObject({
    documentId: z.string().min(20),
    labels: z.array(z.string().min(1).max(50)).optional()
  }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateDocumentLabels(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});

/**
 * Insert document extraction
 *
 * @mcp
 */
export const insertDocumentExtraction = defineServiceFn({
  input: z.looseObject({
    storagePath: z.string(),
    documentType: z.enum(["purchaseInvoice", "salesRfq"]),
    sourceDocument: z.string(),
    sourceDocumentId: z.string().optional()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    const foreign = service.refuseForeignPath(ctx, input.storagePath);
    if (foreign) return foreign;
    return unwrap(
      ctx,
      await service.insertDocumentExtraction(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});
