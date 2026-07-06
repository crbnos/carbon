import { requirePermissions } from "@carbon/auth/auth.server";
import { DOCUMENT_PDFS, ensureFont } from "@carbon/documents/pdf";
import {
  blockSchema,
  CURRENT_TEMPLATE_FORMAT_VERSION,
  collectSectionIds,
  DEFAULT_DOCUMENT_SETTINGS,
  documentSettingsSchema,
  documentTemplateTypeSchema,
  sectionConfigSchema,
  themeSchema
} from "@carbon/documents/template";
import { getPreferenceHeaders, labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getCompany, resolveSections } from "~/modules/settings";
import { buildPreviewProps } from "~/modules/settings/documentPreview.server";

/**
 * Renders a sample of the document with the draft block layout, server-side.
 * Keeps @react-pdf/renderer off the client entirely (it relies on Node's
 * Buffer/streams) and guarantees the preview matches the real PDF route.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "settings"
    }
  );

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
  const settings = settingsParsed.success
    ? settingsParsed.data
    : { ...DEFAULT_DOCUMENT_SETTINGS };

  if (!parsed.success || !theme.success) {
    return new Response("Invalid template", { status: 400 });
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
  const real = previewId
    ? await buildPreviewProps(
        client,
        companyId,
        companyGroupId,
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
