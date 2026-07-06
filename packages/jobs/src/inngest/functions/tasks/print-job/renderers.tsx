// This module is .tsx because the built-in renderers render React PDF
// components (ProductLabelPDF, StorageUnitLabelPDF, KanbanLabelPDF) via
// renderToStream.

import type { Database } from "@carbon/database";
import { resolveLabelLogo } from "@carbon/documents/labels";
import {
  KanbanLabelPDF,
  ProductLabelPDF,
  StorageUnitLabelPDF
} from "@carbon/documents/pdf";
import { toDocumentTemplate } from "@carbon/documents/template";
import {
  generateProductLabelZPL,
  generateStorageUnitLabelZPL
} from "@carbon/documents/zpl";
import { ERP_URL, SUPABASE_URL } from "@carbon/env";
import { renderWithBinderyPress } from "@carbon/printing/printing.server";
import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactElement } from "react";
import type { KanbanCardItem, StorageUnitItem } from "./resolvers";

export type GeneratedContent = {
  content: string;
  contentType: "zpl" | "pdf";
};

/** A single resolved item tagged with the document type that renders it. */
export type PrintableDocumentItem =
  | { type: "productLabel"; item: ProductLabelItem }
  | { type: "kanbanCard"; item: KanbanCardItem }
  | { type: "storageUnitLabel"; item: StorageUnitItem };

export async function renderItemWithTemplate(
  doc: PrintableDocumentItem,
  templateId: string,
  apiKey: string,
  format: "zpl" | "pdf"
): Promise<GeneratedContent> {
  const result = await renderWithBinderyPress({
    apiKey,
    templateId,
    data: { ...doc.item },
    format
  });

  return {
    content: result.content,
    contentType: result.contentType
  };
}

export async function renderItemBuiltIn(
  client: SupabaseClient<Database>,
  companyId: string,
  doc: PrintableDocumentItem,
  format: "zpl" | "pdf",
  mediaSizeId: string
): Promise<GeneratedContent> {
  switch (doc.type) {
    case "productLabel": {
      const mediaSize = requireMediaSize(mediaSizeId);
      // Apply the company's tracking-label template + logo, same as the
      // interactive download routes — otherwise queued jobs print a layout
      // that doesn't match what the customizer shows.
      const { template, logo } = await loadProductLabelContext(
        client,
        companyId,
        mediaSize
      );
      if (format === "pdf") {
        return renderPdfContent(
          <ProductLabelPDF
            items={[doc.item]}
            labelSize={mediaSize}
            template={template}
            logo={logo}
          />
        );
      }
      requireZplCapable(mediaSize);
      return {
        content: generateProductLabelZPL(doc.item, mediaSize, template, logo),
        contentType: "zpl"
      };
    }
    case "kanbanCard":
      return renderKanbanCardPDF(client, doc.item, format);
    case "storageUnitLabel": {
      const mediaSize = requireMediaSize(mediaSizeId);
      if (format === "pdf") {
        return renderPdfContent(
          <StorageUnitLabelPDF items={[doc.item]} labelSize={mediaSize} />
        );
      }
      requireZplCapable(mediaSize);
      return {
        content: generateStorageUnitLabelZPL(doc.item, mediaSize),
        contentType: "zpl"
      };
    }
  }
}

function requireMediaSize(mediaSizeId: string): LabelSize {
  const mediaSize = labelSizes.find((s) => s.id === mediaSizeId);
  if (!mediaSize) {
    throw new Error(`Unknown media size ${mediaSizeId}`);
  }
  return mediaSize;
}

const PUBLIC_STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/public/`;

/**
 * Resolve the company's tracking-label template + logo for a built-in render.
 * Mirrors the interactive label routes (which use `getDocumentTemplateConfig`
 * + `resolveLabelLogo`) so queued print jobs honor the customizer layout. The
 * jobs package can't import app modules, so it reads the row directly here.
 */
async function loadProductLabelContext(
  client: SupabaseClient<Database>,
  companyId: string,
  labelSize: LabelSize
) {
  const [templateRow, companyRow] = await Promise.all([
    client
      .from("documentTemplate")
      .select("*")
      .eq("companyId", companyId)
      .eq("documentType", "trackingLabel")
      .maybeSingle(),
    client
      .from("company")
      .select("logoLight, logoLightIcon")
      .eq("id", companyId)
      .maybeSingle()
  ]);

  const template = toDocumentTemplate(templateRow.data, "trackingLabel");

  const expand = (path: string | null | undefined) =>
    path ? `${PUBLIC_STORAGE_URL_PREFIX}${path}` : null;
  const company = companyRow.data
    ? {
        logoLight: expand(companyRow.data.logoLight),
        logoLightIcon: expand(companyRow.data.logoLightIcon)
      }
    : null;

  const logo = await resolveLabelLogo(company, template, labelSize, {
    supabaseUrl: SUPABASE_URL ?? ""
  });

  return { template, logo };
}

function requireZplCapable(mediaSize: LabelSize): void {
  if (!mediaSize.zpl) {
    throw new Error(`Media size ${mediaSize.id} does not support ZPL`);
  }
}

async function renderPdfContent(
  element: ReactElement
): Promise<GeneratedContent> {
  const stream = await renderToStream(element);
  const body = await streamToBuffer(stream);

  return {
    content: body.toString("base64"),
    contentType: "pdf"
  };
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (d: Uint8Array) => buffers.push(d));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });
}

async function renderKanbanCardPDF(
  client: SupabaseClient<Database>,
  item: KanbanCardItem,
  format: "zpl" | "pdf"
): Promise<GeneratedContent> {
  if (format === "zpl") {
    throw new Error(
      "Built-in kanban card generation only supports PDF printers."
    );
  }

  let thumbnail: string | null = null;
  if (item.thumbnailPath) {
    const { data } = await client.storage
      .from("private")
      .download(item.thumbnailPath);
    if (data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      const ext = item.thumbnailPath.split(".").pop()?.toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      thumbnail = `data:${mime};base64,${buffer.toString("base64")}`;
    }
  }

  return renderPdfContent(
    <KanbanLabelPDF
      baseUrl={ERP_URL ?? ""}
      labels={[
        {
          id: item.id,
          itemId: item.itemId,
          itemName: item.itemName,
          itemReadableId: item.itemId,
          locationName: item.locationName,
          storageUnitId: item.storageUnitId,
          storageUnitName: item.storageUnitName,
          supplierName: item.supplierName,
          quantity: item.quantity,
          unitOfMeasureCode: item.unitOfMeasureCode,
          thumbnail
        }
      ]}
      action="order"
    />
  );
}
