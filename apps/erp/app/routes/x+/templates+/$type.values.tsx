// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { DOCUMENT_PDFS, ensureFont } from "@carbon/documents/pdf";
import {
  collectValues,
  documentTemplateTypeSchema,
  resolveTemplate
} from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { templatePreviewProps } from "~/modules/settings/document-edit.pdf";

const logger = getLogger("erp", "templates", "values");

/**
 * The values a template preview prints, which a click on it reads. Only a render
 * holds them, because a table row's variables are built as it prints. It prints
 * every block, so a block the user shows later has its values, and the default
 * words, because the draft's words do not change a value.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });
  const documentType = documentTemplateTypeSchema.parse(params.type);
  const previewId = new URL(request.url).searchParams.get("previewId");
  const template = resolveTemplate(documentType, null);
  const { Component } = DOCUMENT_PDFS[documentType];
  const { collector, collected } = collectValues();

  const props = await templatePreviewProps(request, client, {
    companyId,
    documentType,
    previewId,
    locale: getPreferenceHeaders(request).locale
  });
  try {
    await ensureFont(template.settings.fontFamily);
    const stream = await renderToStream(
      <Component
        {...props}
        template={{
          ...template,
          blocks: template.blocks.map((block) => ({ ...block, visible: true }))
        }}
        valueCollector={collector}
      />
    );
    // The collector has heard everything once the PDF is written.
    await new Promise((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
      stream.resume();
    });
  } catch (error) {
    logger.error("Failed to read the preview's values", {
      companyId,
      documentType,
      previewId,
      error
    });
    throw new Response("The preview's values could not be read.", {
      status: 500
    });
  }
  return data({ data: collected });
}
