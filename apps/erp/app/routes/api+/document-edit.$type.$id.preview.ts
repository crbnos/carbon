// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  blockSchema,
  diffDocumentEdit,
  documentSettingsSchema,
  isDocumentEditType
} from "@carbon/documents/template";
import { getPrintedTemplate } from "@carbon/lib/document-edit.server";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { renderDocumentWithEdit } from "~/modules/settings/document-edit.pdf";
import { DOCUMENT_EDIT_RECORDS } from "~/modules/settings/settings.models";

const logger = getLogger("erp", "document-edit", "preview");

/**
 * The real PDF of one record with the editor's unsaved draft applied. The draft
 * is reduced to what differs from the company template, exactly as a save is.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { type, id } = params;
  if (!type || !isDocumentEditType(type) || !id) {
    throw new Response("Document not found", { status: 404 });
  }
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: DOCUMENT_EDIT_RECORDS[type].module }
  );

  const formData = await request.formData();
  const blocks = z
    .array(blockSchema)
    .safeParse(JSON.parse(String(formData.get("blocks") ?? "[]")));
  const settings = documentSettingsSchema.safeParse(
    JSON.parse(String(formData.get("settings") ?? "{}"))
  );
  if (!blocks.success || !settings.success) {
    return new Response("Invalid document", { status: 400 });
  }

  // `null`: the company template alone, to diff the draft against.
  const template = await getPrintedTemplate(
    client,
    { companyId, documentType: type, documentId: id },
    null
  );
  const edit = diffDocumentEdit(type, template, {
    blocks: blocks.data,
    settings: settings.data
  });

  try {
    return await renderDocumentWithEdit(client, {
      documentType: type,
      documentId: id,
      companyId,
      companyGroupId,
      locale: getPreferenceHeaders(request).locale,
      edit
    });
  } catch (error) {
    logger.error("Failed to render the document preview", {
      companyId,
      documentType: type,
      documentId: id,
      error
    });
    throw new Response("The preview could not be rendered.", { status: 500 });
  }
}
