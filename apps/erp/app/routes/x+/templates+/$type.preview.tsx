// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { DOCUMENT_PDFS, ensureFont } from "@carbon/documents/pdf";
import {
  blockSchema,
  CURRENT_TEMPLATE_FORMAT_VERSION,
  collectSectionIds,
  DEFAULT_DOCUMENT_SETTINGS,
  documentSettingsSchema,
  documentTemplateTypeSchema,
  isFigureProblem,
  sectionConfigSchema,
  themeSchema,
  validateTemplateText
} from "@carbon/documents/template";
import { getPreferenceHeaders, labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  buildPreviewProps,
  getCompany,
  resolveSections
} from "~/modules/settings/settings.service";

/**
 * Renders a sample of the document with the draft block layout, server-side.
 * Keeps @react-pdf/renderer off the client entirely (it relies on Node's
 * Buffer/streams) and guarantees the preview matches the real PDF route.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const documentType = documentTemplateTypeSchema.parse(params.type);

  const formData = await request.formData();
  const parsed = z
    .array(blockSchema)
    .safeParse(JSON.parse(String(formData.get("blocks") ?? "[]")));
  const theme = themeSchema.safeParse(
    JSON.parse(String(formData.get("theme") ?? "{}"))
  );
  const settingsParsed = documentSettingsSchema.safeParse(
    JSON.parse(String(formData.get("settings") ?? "{}"))
  );
  // A template has no values of its own: they belong to one record's edits.
  const settings = settingsParsed.success
    ? { ...settingsParsed.data, valueEdits: undefined }
    : { ...DEFAULT_DOCUMENT_SETTINGS };

  if (!parsed.success || !theme.success) {
    return new Response("Invalid template", { status: 400 });
  }

  const figureProblems = validateTemplateText({
    documentType,
    blocks: parsed.data,
    settings
  }).filter(isFigureProblem);
  if (figureProblems.length > 0) {
    return new Response(figureProblems.map((p) => p.message).join("\n"), {
      status: 400
    });
  }

  const headerSectionId = String(formData.get("headerSectionId") ?? "") || null;
  const footerSectionId = String(formData.get("footerSectionId") ?? "") || null;

  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds({ blocks: parsed.data, headerSectionId, footerSectionId })
  );

  // Apply the live (unsaved) header config draft so logo/header edits show in
  // the preview instantly, without waiting for a Save + revalidation.
  const headerConfig = sectionConfigSchema.safeParse(
    JSON.parse(String(formData.get("headerConfig") ?? "{}"))
  );
  if (headerConfig.success && headerSectionId && sections[headerSectionId]) {
    sections[headerSectionId] = {
      ...sections[headerSectionId],
      config: {
        ...sections[headerSectionId].config,
        ...headerConfig.data
      }
    };
  }

  const { locale } = getPreferenceHeaders(request);

  await ensureFont(settings.fontFamily);

  const { Component, sample } = DOCUMENT_PDFS[documentType];

  // When a record is picked, render the draft layout against its live data.
  // Otherwise fall back to sample data with the real company branding.
  const previewId = String(formData.get("previewId") ?? "") || null;
  // A draft can reword or hide anything, so printing it on a real record is
  // editing, not viewing.
  if (previewId) await requirePermissions(request, { update: "settings" });
  const real = previewId
    ? await buildPreviewProps(
        client,
        companyId,
        documentType,
        previewId,
        locale
      )
    : null;

  let baseProps: Record<string, unknown>;
  if (real) {
    baseProps = real;
  } else {
    // Use the real company so the preview shows the actual logo / branding;
    // everything else (line items, totals) stays sample data.
    const company = await getCompany(client, companyId);
    baseProps = { ...sample, company: company.data ?? sample.company, locale };
  }

  // Tracking-label preview: render against the picked stock (the layout scales
  // to any size). Overrides the sample's fixed size.
  if (documentType === "trackingLabel") {
    const size = labelSizes.find(
      (s) => s.id === String(formData.get("labelSizeId") ?? "")
    );
    if (size) baseProps.labelSize = size;
  }

  const stream = await renderToStream(
    <Component
      {...baseProps}
      template={{
        formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
        documentType,
        blocks: parsed.data,
        theme: theme.data,
        settings,
        headerSectionId,
        footerSectionId
      }}
      sections={sections}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => buffers.push(data));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "Content-Type": "application/pdf" }
  });
}
