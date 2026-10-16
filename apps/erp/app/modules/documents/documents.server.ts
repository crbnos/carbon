// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { envelope, paged, stamp } from "@carbon/api/service-tools.server";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { isUnsafeStoragePath } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { z } from "zod";
import { isAssemblerServiceHealthy } from "~/modules/production/production.service";
import { refuseUnlessOwned } from "~/modules/shared/shared.service";
import { modelViewDirection } from "./documents.models";
import * as service from "./documents.service";

const logger = getLogger("erp", "documents");
/**
 * Record an uploaded CAD model and attach it to the records it belongs to.
 *
 * @remarks
 * The file is already in storage at `modelPath`, which must sit under the
 * company's own prefix (`<companyId>/…`) and must not escape it. Inserts the
 * `modelUpload` row (`originalSize` and `originalPath` keep the as-uploaded
 * size and path), then sets it as the model of each record named: `itemId`,
 * `salesRfqLineId`, `quoteLineId`, `salesOrderLineId`, `jobId`. A failed
 * attach is logged and does not fail the upload. With `convert`, a STEP file
 * also starts the assembler's conversion when the assembler is up (best
 * effort). Every model is queued for optimisation, which also renders its
 * thumbnail.
 */
export const uploadModel = defineServiceFn({
  input: z.object({
    modelId: z.string().min(1),
    name: z.string().min(1),
    modelPath: z.string().min(1),
    size: z.number(),
    convert: z.boolean().optional(),
    itemId: z.string().optional(),
    salesRfqLineId: z.string().optional(),
    quoteLineId: z.string().optional(),
    salesOrderLineId: z.string().optional(),
    jobId: z.string().optional()
  }),
  permission: { update: "parts" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const { modelId, modelPath } = input;

    // The path is the caller's: never let it point outside this tenant's
    // storage prefix or escape it via traversal.
    if (
      !modelPath.startsWith(`${companyId}/`) ||
      isUnsafeStoragePath(modelPath)
    ) {
      return ctx.error("validation", "Invalid model path");
    }

    const recorded = await client.from("modelUpload").insert({
      id: modelId,
      modelPath,
      name: input.name,
      size: input.size,
      // `size` is later overwritten with the compacted (.zst) stored size;
      // the viewer's reduction badge compares against the original.
      originalSize: input.size,
      // `modelPath` is later repointed at the compacted artifact (STEP →
      // `.xbf.zst`), but downloads serve the original bytes. Mesh compaction
      // nulls this again (its `.zst` decompresses to the original).
      originalPath: modelPath,
      companyId,
      createdBy: userId
    });
    if (recorded.error) {
      return ctx.error("internal", "Failed to record upload", recorded.error);
    }

    const attached = await Promise.all([
      input.itemId
        ? client
            .from("item")
            .update({ modelUploadId: modelId })
            .eq("id", input.itemId)
            .eq("companyId", companyId)
        : null,
      input.salesRfqLineId
        ? client
            .from("salesRfqLine")
            .update({ modelUploadId: modelId })
            .eq("id", input.salesRfqLineId)
            .eq("companyId", companyId)
        : null,
      input.quoteLineId
        ? client
            .from("quoteLine")
            .update({ modelUploadId: modelId })
            .eq("id", input.quoteLineId)
            .eq("companyId", companyId)
        : null,
      input.salesOrderLineId
        ? client
            .from("salesOrderLine")
            .update({ modelUploadId: modelId })
            .eq("id", input.salesOrderLineId)
            .eq("companyId", companyId)
        : null,
      input.jobId
        ? client
            .from("job")
            .update({ modelUploadId: modelId })
            .eq("id", input.jobId)
            .eq("companyId", companyId)
        : null
    ]);
    for (const result of attached) {
      if (result?.error) {
        logger.error("Failed to attach the uploaded model", {
          companyId,
          modelId,
          error: result.error
        });
      }
    }

    // Conversion to assembly-instruction artifacts (GLB + graph) is lazy:
    // most models never become assemblies. A caller that renders the model on
    // the shop floor (a BOP step's model slide) opts in with `convert`.
    // STEP only, and skipped when the assembler is down: the viewer falls
    // back to parsing the raw model in the browser.
    const isStep = [".step", ".stp"].some((ext) =>
      modelPath.toLowerCase().endsWith(ext)
    );
    if (input.convert && isStep && (await isAssemblerServiceHealthy())) {
      try {
        await trigger("assembly-convert", {
          companyId,
          modelUploadId: modelId,
          userId
        });
      } catch (error) {
        logger.error("Failed to start model conversion", { modelId, error });
      }
    }

    // The job derives the format from the stored file and skips non-mesh
    // inputs, so it is queued for every model. Its success renders the
    // thumbnail (it draws the GLB the optimise produces).
    await trigger("model-optimize", {
      modelUploadId: modelId,
      companyId,
      userId
    });

    return { modelUploadId: modelId };
  }
});

/**
 * Render a model's preview thumbnail again.
 *
 * @remarks
 * The model must be the company's. `direction` is the viewer's camera (model
 * towards camera, Z up); without it the home view is drawn. Any employee may
 * ask: a preview is part of viewing, not part editing. Clears the thumbnail
 * of every item using the model, so the new render shows instead of an old
 * or broken item thumbnail, then queues the render. The render writes the
 * model's new `thumbnailPath` when it lands.
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

    // `get_part_details` prefers `item.thumbnailPath` over the model's, so an
    // item thumbnail would mask the new render and come back on reload.
    await ctx.asCaller.supabase
      .from("item")
      .update({ thumbnailPath: null })
      .eq("modelUploadId", modelUploadId)
      .eq("companyId", companyId);

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
        .update({ optimizeStatus: "Queued", optimizeError: null })
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
    return envelope(
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
    return envelope(
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
export const getDocumentExtensions = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "documents" },
  async run(ctx) {
    return envelope(
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
    return envelope(
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
    return envelope(
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
    return envelope(
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
 * Upsert document
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
      await service.upsertDocument(
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
      await service.upsertDocument(
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
export const createDocumentUploadUrl = defineServiceFn({
  input: z.looseObject({
    folder: z.string(),
    entityId: z.string(),
    name: z.string()
  }),
  permission: { create: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await service.createDocumentUploadUrl(
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
    return envelope(
      ctx,
      await service.insertUploadedDocument(
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
export const updateDocumentFavorite = defineServiceFn({
  input: z.looseObject({ id: z.string(), favorite: z.boolean() }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await service.updateDocumentFavorite(
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
export const updateDocumentLabels = defineServiceFn({
  input: z.looseObject({
    documentId: z.string().min(20),
    labels: z.array(z.string().min(1).max(50)).optional()
  }),
  permission: { update: "documents" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await service.updateDocumentLabels(
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
export const insertDocumentExtraction = defineServiceFn({
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
      await service.insertDocumentExtraction(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});
