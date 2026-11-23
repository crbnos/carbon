// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { BINDERY_PRESS_API_KEY } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { DocumentTypeId, PrintJobOrigin } from "@carbon/printing";
import {
  createPrintJob,
  getDocumentType,
  getDocumentTypesForSource,
  getLabelTemplatesForMediaSize,
  getLabelTemplateType,
  getPrinterContextForSource,
  type LabelTemplateType,
  updatePrintJobContent,
  updatePrintJobStatus
} from "@carbon/printing";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import { DEFAULT_LABEL_DPI } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError } from "inngest";
import { inngest } from "../../../client";

const log = getLogger("jobs", "print-job");

import type { GeneratedContent, PrintableDocumentItem } from "./renderers";
import { renderItemBuiltIn, renderItemWithTemplate } from "./renderers";
import {
  type KanbanCardItem,
  resolveKanbanData,
  resolvePackingSlipData,
  resolveSalesInvoiceData,
  resolveStorageUnitData,
  resolveTrackedEntityData
} from "./resolvers";

const DEFAULT_MEDIA_SIZE_ID = "label2x1";

type Payload = {
  sourceDocument: string;
  sourceDocumentId: string;
  companyId: string;
  userId: string;
  locationId?: string;
  workCenterId?: string;
  printerRouteId?: string;
};

export const printJobFunction = inngest.createFunction(
  { id: "print-job", retries: 0 },
  { event: "carbon/print-job" },
  async ({ event, step }) => {
    const client = getCarbonServiceRole();
    const payload: Payload = event.data;
    const {
      sourceDocument,
      sourceDocumentId,
      companyId,
      userId,
      locationId,
      workCenterId,
      printerRouteId: explicitPrinterRouteId
    } = payload;

    // Everything that writes print jobs runs in ONE step. A step makes Inngest
    // run the function again from the top, so code outside a step runs again:
    // the duplicate guard then saw the job just written and threw, and a
    // kanban's Start and Complete cards (the second label onward of any
    // document) were never printed.
    const { printJobIds, deliverJobIds } = await step.run(
      "create-print-jobs",
      async () => {
        // A printer named by the request is a person's print: it is never a
        // repeat of an automatic one, so only automatic prints are held back.
        const origin: PrintJobOrigin = explicitPrinterRouteId
          ? "manual"
          : "auto";
        if (origin === "auto") {
          const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
          const { count: recentJobCount } = await client
            .from("printJob")
            .select("id", { count: "exact", head: true })
            .eq("sourceDocument", sourceDocument)
            .eq("sourceDocumentId", sourceDocumentId)
            .eq("companyId", companyId)
            .eq("origin", "auto")
            .gte("createdAt", thirtySecondsAgo);

          if (recentJobCount && recentJobCount > 0) {
            throw new NonRetriableError(
              `Print jobs already exist for ${sourceDocument} ${sourceDocumentId}`
            );
          }
        }

        let printerConfig: Awaited<ReturnType<typeof getCachedPrinterConfig>> =
          null;

        if (explicitPrinterRouteId) {
          const { data: route } = await client
            .from("printerRoute")
            .select("id, name, format, mediaSizeId, dpi, printerUrl")
            .eq("id", explicitPrinterRouteId)
            .eq("companyId", companyId)
            .single();
          if (route) {
            printerConfig = {
              printerRouteId: route.id,
              printerUrl: route.printerUrl,
              format: route.format as "zpl" | "pdf",
              mediaSizeId: route.mediaSizeId,
              dpi: route.dpi,
              autoPrint: true
            };
          }
        } else if (locationId) {
          printerConfig = await getCachedPrinterConfig(
            client,
            companyId,
            locationId,
            getPrinterContextForSource(sourceDocument, workCenterId),
            workCenterId
          );
        }

        // Templates are set per media size, so they apply only to a printer
        // with one; without it every label renders built-in.
        const templates = printerConfig?.mediaSizeId
          ? await getLabelTemplatesForMediaSize(
              client,
              companyId,
              printerConfig.mediaSizeId
            )
          : new Map<LabelTemplateType, string>();

        const documentTypeIds = getDocumentTypesForSource(sourceDocument);
        const allPrintJobIds: string[] = [];
        const allDeliverJobIds: string[] = [];

        for (const documentTypeId of documentTypeIds) {
          const docType = getDocumentType(documentTypeId);
          if (!docType) continue;

          const created = await processDocumentType(client, {
            documentTypeId,
            hasBuiltInRenderer: docType.builtInRenderer !== null,
            sourceDocument,
            sourceDocumentId,
            companyId,
            userId,
            printerUrl: printerConfig?.printerUrl ?? "",
            format: printerConfig?.format ?? docType.defaultFormat,
            mediaSizeId: printerConfig?.mediaSizeId ?? DEFAULT_MEDIA_SIZE_ID,
            // Configs cached before printers had a dpi carry none.
            dpi: printerConfig?.dpi ?? DEFAULT_LABEL_DPI,
            templates,
            origin
          });

          allPrintJobIds.push(...created.printJobIds);
          allDeliverJobIds.push(...created.deliverJobIds);
        }

        return { printJobIds: allPrintJobIds, deliverJobIds: allDeliverJobIds };
      }
    );

    if (deliverJobIds.length > 0) {
      await step.sendEvent(
        "deliver",
        deliverJobIds.map((printJobId) => ({
          name: "carbon/print-job-deliver" as const,
          data: { printJobId, companyId }
        }))
      );
    }

    return { printJobIds, count: printJobIds.length };
  }
);

async function resolveDocumentItems(
  client: SupabaseClient<Database>,
  documentTypeId: DocumentTypeId,
  sourceDocument: string,
  sourceDocumentId: string,
  companyId: string
): Promise<{ docs: PrintableDocumentItem[]; readableId: string | null }> {
  switch (documentTypeId) {
    case "productLabel": {
      const resolved = await resolveTrackedEntityData(
        client,
        sourceDocument,
        sourceDocumentId,
        companyId
      );
      return {
        docs:
          resolved?.items.map((item) => ({
            type: "productLabel" as const,
            item
          })) ?? [],
        readableId: resolved?.readableId ?? null
      };
    }
    case "kanbanCard": {
      const resolved = await resolveKanbanData(client, sourceDocumentId);
      return {
        docs:
          resolved?.items.map((item) => ({
            type: "kanbanCard" as const,
            item
          })) ?? [],
        readableId: resolved?.readableId ?? null
      };
    }
    case "storageUnitLabel": {
      const resolved = await resolveStorageUnitData(client, sourceDocumentId);
      return {
        docs:
          resolved?.items.map((item) => ({
            type: "storageUnitLabel" as const,
            item
          })) ?? [],
        readableId: resolved?.readableId ?? null
      };
    }
    case "packingSlip": {
      const resolved = await resolvePackingSlipData(
        client,
        sourceDocumentId,
        companyId
      );
      return {
        docs: [{ type: "packingSlip" as const, item: resolved.pdfProps }],
        readableId: resolved.readableId
      };
    }
    case "salesInvoice": {
      const resolved = await resolveSalesInvoiceData(
        client,
        sourceDocumentId,
        companyId
      );
      return {
        docs: [{ type: "salesInvoice" as const, item: resolved.pdfProps }],
        readableId: resolved.readableId
      };
    }
  }
}

const KANBAN_CARD_NAMES: Record<KanbanCardItem["action"], string> = {
  order: "Create",
  start: "Start",
  complete: "Complete"
};

function describeDocument(
  doc: PrintableDocumentItem,
  readableId: string | null,
  sourceDocumentId: string
): string {
  const parts = [readableId ?? sourceDocumentId];

  switch (doc.type) {
    case "productLabel":
      if (doc.item.itemId) parts.push(doc.item.itemId);
      if (doc.item.number) parts.push(doc.item.number);
      break;
    case "kanbanCard":
      if (doc.item.itemId) parts.push(doc.item.itemId);
      parts.push(KANBAN_CARD_NAMES[doc.item.action]);
      break;
    case "storageUnitLabel":
    case "packingSlip":
    case "salesInvoice":
      break;
  }

  return parts.join(" — ");
}

/** Writes and renders a print job per document; returns the jobs to send
 *  to a printer (the caller delivers them, outside the step). */
async function processDocumentType(
  client: SupabaseClient<Database>,
  ctx: {
    documentTypeId: DocumentTypeId;
    hasBuiltInRenderer: boolean;
    sourceDocument: string;
    sourceDocumentId: string;
    companyId: string;
    userId: string;
    printerUrl: string;
    format: "zpl" | "pdf";
    mediaSizeId: string;
    dpi: number;
    templates: Map<LabelTemplateType, string>;
    origin: PrintJobOrigin;
  }
): Promise<{ printJobIds: string[]; deliverJobIds: string[] }> {
  const {
    documentTypeId,
    hasBuiltInRenderer,
    sourceDocument,
    sourceDocumentId,
    companyId,
    userId,
    printerUrl,
    format,
    mediaSizeId,
    dpi,
    templates,
    origin
  } = ctx;
  const printJobIds: string[] = [];
  const deliverJobIds: string[] = [];

  let resolved: Awaited<ReturnType<typeof resolveDocumentItems>>;
  try {
    resolved = await resolveDocumentItems(
      client,
      documentTypeId,
      sourceDocument,
      sourceDocumentId,
      companyId
    );
  } catch (resolveError) {
    // Record the failure so the Print Manager shows why nothing printed.
    const message =
      resolveError instanceof Error
        ? resolveError.message
        : String(resolveError);
    log.error("Could not read {sourceDocument} {sourceDocumentId}", {
      sourceDocument,
      sourceDocumentId,
      error: message
    });
    const job = await createPrintJob(client, {
      companyId,
      printerUrl,
      sourceDocument,
      sourceDocumentId,
      description: sourceDocumentId,
      origin,
      createdBy: userId
    });
    if (job.data) {
      printJobIds.push(job.data.id);
      await updatePrintJobStatus(client, job.data.id, companyId, "failed", {
        error: `Could not read the document: ${message}`
      });
    }
    return { printJobIds, deliverJobIds };
  }

  const { docs, readableId } = resolved;
  if (docs.length === 0) return { printJobIds, deliverJobIds };

  for (const doc of docs) {
    const job = await createPrintJob(client, {
      companyId,
      printerUrl,
      sourceDocument,
      sourceDocumentId,
      sourceDocumentReadableId: readableId ?? undefined,
      description: describeDocument(doc, readableId, sourceDocumentId),
      status: "generating",
      origin,
      createdBy: userId
    });

    if (job.error || !job.data) {
      log.error("Failed to create print job", { error: job.error });
      continue;
    }

    const jobId = job.data.id;
    printJobIds.push(jobId);

    const labelType = getLabelTemplateType(
      documentTypeId,
      doc.type === "productLabel" ? doc.item.trackingType : null
    );
    const templateId = labelType ? templates.get(labelType) : undefined;

    try {
      let content: GeneratedContent;
      // Custom templates are drawn at 203 dpi whatever the printer runs at.
      let renderedDpi: number = DEFAULT_LABEL_DPI;

      if (templateId && BINDERY_PRESS_API_KEY) {
        content = await renderItemWithTemplate(
          doc,
          templateId,
          BINDERY_PRESS_API_KEY,
          format
        );
      } else if (hasBuiltInRenderer) {
        content = await renderItemBuiltIn(
          client,
          companyId,
          doc,
          format,
          mediaSizeId,
          dpi
        );
        renderedDpi = dpi;
      } else {
        await updatePrintJobStatus(client, jobId, companyId, "failed", {
          error: `No built-in renderer for "${documentTypeId}". Add a "${labelType}" label template for media size "${mediaSizeId}".`
        });
        continue;
      }

      await updatePrintJobContent(
        client,
        jobId,
        companyId,
        content.content,
        content.contentType,
        renderedDpi
      );

      if (printerUrl) {
        deliverJobIds.push(jobId);
      } else {
        await updatePrintJobStatus(client, jobId, companyId, "completed");
      }
    } catch (renderError) {
      const message =
        renderError instanceof Error
          ? renderError.message
          : String(renderError);
      log.error("Rendering failed for job {jobId}", { jobId, error: message });
      await updatePrintJobStatus(client, jobId, companyId, "failed", {
        error: `Rendering failed: ${message}`
      });
    }
  }

  return { printJobIds, deliverJobIds };
}
