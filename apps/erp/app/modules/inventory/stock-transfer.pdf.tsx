// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { ensureFont, StockTransferPDF } from "@carbon/documents/pdf";
import {
  collectSectionIds,
  type DocumentEdit,
  type ValueCollector
} from "@carbon/documents/template";
import { getPrintedTemplate } from "@carbon/lib/document-edit.server";
import { getLogger } from "@carbon/logger";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCompany,
  resolveSections
} from "~/modules/settings/settings.service";
import { getBase64ImageFromSupabase } from "~/modules/shared/shared.service";
import { getStockTransfer, getStockTransferLines } from "./inventory.service";

const logger = getLogger("erp", "stock-transfer", "pdf");

/** A stock transfer's pick list as a PDF response. */
export async function renderStockTransferPdf(
  client: SupabaseClient<Database>,
  {
    companyId,
    stockTransferId: id,
    locale,
    edit,
    valueCollector
  }: {
    companyId: string;
    stockTransferId: string;
    locale: string;
    /** Draft edits to preview; omitted, the saved ones are read. */
    edit?: DocumentEdit | null;
    valueCollector?: ValueCollector;
  }
): Promise<Response> {
  const [company, stockTransfer, stockTransferLines] = await Promise.all([
    getCompany(client, companyId),
    getStockTransfer(client, id),
    getStockTransferLines(client, id)
  ]);

  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
  }

  if (stockTransfer.error) {
    logger.error("Failed to load stockTransfer", {
      error: stockTransfer.error
    });
  }

  if (stockTransferLines.error) {
    logger.error("Failed to load stockTransferLines", {
      error: stockTransferLines.error
    });
  }

  if (
    company.error ||
    stockTransfer.error ||
    stockTransferLines.error ||
    stockTransfer.data.companyId !== companyId
  ) {
    throw new Error("Failed to load stock transfer");
  }

  // Get location information
  const location = await client
    .from("location")
    .select("*")
    .eq("id", stockTransfer.data.locationId)
    .eq("companyId", companyId)
    .single();

  if (location.error) {
    logger.error("Failed to load location", { error: location.error });
    throw new Error("Failed to load location");
  }

  const templateConfig = await getPrintedTemplate(
    client,
    { companyId, documentType: "stockTransfer", documentId: id },
    edit
  );
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(templateConfig)
  );
  await ensureFont(templateConfig.settings.fontFamily);

  // Get thumbnails for items
  const thumbnailPaths = stockTransferLines.data?.reduce<
    Record<string, string | null>
  >((acc, line) => {
    if (line.thumbnailPath) {
      acc[line.id!] = line.thumbnailPath;
    }
    return acc;
  }, {});

  const thumbnails: Record<string, string | null> =
    (thumbnailPaths
      ? await Promise.all(
          Object.entries(thumbnailPaths).map(([id, path]) => {
            if (!path) {
              return null;
            }
            return getBase64ImageFromSupabase(client, path).then((data) => ({
              id,
              data
            }));
          })
        )
      : []
    )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
      if (thumbnail) {
        acc[thumbnail.id] = thumbnail.data;
      }
      return acc;
    }, {}) ?? {};

  const stream = await renderToStream(
    <StockTransferPDF
      valueCollector={valueCollector}
      company={company.data as any}
      stockTransfer={stockTransfer.data}
      stockTransferLines={stockTransferLines.data ?? []}
      location={location.data}
      locale={locale}
      meta={{
        author: "Carbon",
        keywords: "stock transfer",
        subject: "Stock Transfer"
      }}
      thumbnails={thumbnails}
      template={templateConfig}
      sections={sections}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${stockTransfer.data.stockTransferId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
