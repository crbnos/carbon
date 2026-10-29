// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { BINDERY_PRESS_API_KEY } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { DocumentTypeId } from "@carbon/printing";
import {
  createPrintJob,
  getDocumentType,
  getDocumentTypesForSource,
  getPrinterContextForSource,
  updatePrintJobContent,
  updatePrintJobStatus
} from "@carbon/printing";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError } from "inngest";
import { inngest } from "../../../client";

const log = getLogger("jobs", "print-job");

import type { GeneratedContent, PrintableDocumentItem } from "./renderers";
import { renderItemBuiltIn, renderItemWithTemplate } from "./renderers";
import {
  type KanbanCardItem,
  resolveKanbanData,
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
        const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
        const { count: recentJobCount } = await client
          .from("printJob")
          .select("id", { count: "exact", head: true })
          .eq("sourceDocumentId", sourceDocumentId)
          .eq("companyId", companyId)
          .eq("origin", "auto")
          .gte("createdAt", thirtySecondsAgo);

        if (recentJobCount && recentJobCount > 0) {
          throw new NonRetriableError(
            `Print jobs already exist for ${sourceDocument} ${sourceDocumentId}`
          );
        }

        let printerConfig: Awaited<ReturnType<typeof getCachedPrinterConfig>> =
          null;

        if (explicitPrinterRouteId) {
          const { data: route } = await client
            .from("printerRoute")
            .select(
              "id, name, format, mediaSizeId, printerUrl, apiKey, templateId"
            )
            .eq("id", explicitPrinterRouteId)
            .eq("companyId", companyId)
            .single();
          if (route) {
            printerConfig = {
              printerRouteId: route.id,
              printerUrl: route.printerUrl,
              format: route.format as "zpl" | "pdf",
              mediaSizeId: route.mediaSizeId,
              templateId: route.templateId,
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
            templateId: printerConfig?.templateId ?? null
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
    templateId: string | null;
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
    templateId
  } = ctx;

  const { docs, readableId } = await resolveDocumentItems(
    client,
    documentTypeId,
    sourceDocument,
    sourceDocumentId,
    companyId
  );
  const printJobIds: string[] = [];
  const deliverJobIds: string[] = [];
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
      origin: "auto",
      createdBy: userId
    });

    if (job.error || !job.data) {
      log.error("Failed to create print job", { error: job.error });
      continue;
    }

    const jobId = job.data.id;
    printJobIds.push(jobId);

    try {
      let content: GeneratedContent;

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
          mediaSizeId
        );
      } else {
        await updatePrintJobStatus(client, jobId, companyId, "failed", {
          error: `Document type "${documentTypeId}" requires a BinderyPress template.`
        });
        continue;
      }

      await updatePrintJobContent(
        client,
        jobId,
        companyId,
        content.content,
        content.contentType
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
