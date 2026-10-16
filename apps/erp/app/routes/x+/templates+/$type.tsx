// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  documentTemplateTypeSchema,
  getDocumentLabel,
  resolveTemplate,
  withBuiltInSections
} from "@carbon/documents/template";
import { validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DocumentTemplateEditor } from "~/components/DocumentTemplateEditor";
import { usePermissions } from "~/hooks";
import { documentTemplateValidator } from "~/modules/settings/settings.models";
import {
  getCompany,
  getCompanySettings,
  getDocumentSections,
  getDocumentTemplate,
  getTerms,
  listPreviewEntities
} from "~/modules/settings/settings.service";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: (params: { type?: string }) => getDocumentLabel(params.type ?? "")
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const documentType = documentTemplateTypeSchema.parse(params.type);

  const [
    stored,
    sections,
    customFieldSchemas,
    previewEntities,
    terms,
    company,
    companySettings
  ] = await Promise.all([
    getDocumentTemplate(client, companyId, documentType),
    getDocumentSections(client, companyId),
    // Custom field definitions for this record type, to offer as insertable
    // blocks. The customField `table` matches the document type.
    getCustomFieldsSchemas(client, { companyId, table: documentType }),
    // Recent records to optionally preview against live data.
    listPreviewEntities(client, companyId, documentType),
    // Company terms setting — seeds the Terms block when it has no content.
    getTerms(client, companyId),
    getCompany(client, companyId),
    // Company's configured label stock — seeds the label-size preview picker.
    getCompanySettings(client, companyId)
  ]);

  // Map the document type to the relevant company terms setting (the Terms
  // block's default/fallback). Internal docs have no terms.
  const TERMS_FIELD: Partial<
    Record<typeof documentType, "salesTerms" | "purchasingTerms">
  > = {
    salesInvoice: "salesTerms",
    salesOrder: "salesTerms",
    quote: "salesTerms",
    packingSlip: "salesTerms",
    purchaseOrder: "purchasingTerms"
  };
  const termsField = TERMS_FIELD[documentType];
  const termsSeed = termsField
    ? ((terms.data as Record<string, JSONContent> | null)?.[termsField] ??
      undefined)
    : undefined;

  const customFields = (
    ((customFieldSchemas.data ?? []).find((t) => t.table === documentType)
      ?.fields ?? []) as { id: string; name: string }[]
  ).map((f) => ({ id: f.id, name: f.name }));

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate(
      documentType,
      (stored.data ?? null) as Parameters<typeof resolveTemplate>[1]
    );

  return {
    documentType,
    blocks,
    theme,
    settings,
    headerSectionId,
    footerSectionId,
    sections: withBuiltInSections(
      (sections.data ?? []) as {
        id: string;
        name: string;
        placement: "body" | "header" | "footer";
        content?: unknown;
        config?: unknown;
      }[]
    ).map((s) => ({
      id: s.id,
      name: s.name,
      placement: s.placement,
      content: (s as { content?: JSONContent }).content,
      config: (s as { config?: Record<string, unknown> }).config
    })),
    customFields,
    previewEntities,
    termsSeed,
    hasWatermark: Boolean(
      (company.data as { logoWatermark?: string | null } | null)?.logoWatermark
    ),
    initialLabelSizeId:
      documentType === "trackingLabel"
        ? ((companySettings.data as { productLabelSize?: string } | null)
            ?.productLabelSize ?? undefined)
        : undefined
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(documentTemplateValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.saveDocumentTemplate(input.data);
}

export default function DocumentTemplateRoute() {
  const {
    documentType,
    blocks,
    theme,
    settings,
    headerSectionId,
    footerSectionId,
    sections,
    customFields,
    previewEntities,
    termsSeed,
    hasWatermark,
    initialLabelSizeId
  } = useLoaderData<typeof loader>();
  const permissions = usePermissions();

  return (
    <DocumentTemplateEditor
      key={documentType}
      documentType={documentType}
      actionPath={path.to.documentTemplate(documentType)}
      initialBlocks={blocks}
      initialTheme={theme}
      initialSettings={settings}
      initialHeaderSectionId={headerSectionId}
      initialFooterSectionId={footerSectionId}
      sections={sections}
      customFields={customFields}
      previewEntities={previewEntities}
      termsSeed={termsSeed as JSONContent | undefined}
      hasWatermark={hasWatermark}
      initialLabelSizeId={initialLabelSizeId}
      canEdit={permissions.can("update", "settings")}
    />
  );
}
