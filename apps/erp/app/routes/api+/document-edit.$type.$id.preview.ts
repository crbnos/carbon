// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  blockSchema,
  documentSettingsSchema,
  editToPrint
} from "@carbon/documents/template";
import {
  getCompanyTemplate,
  getDocumentEdit
} from "@carbon/lib/document-edit.server";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  renderDocumentWithEdit,
  requireDocumentEditRecord
} from "~/modules/settings/document-edit.pdf";

const logger = getLogger("erp", "document-edit", "preview");

/**
 * The real PDF of one record with the editor's unsaved draft applied, for whoever
 * may edit it. `editToPrint` decides what prints.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyGroupId, key, record } =
    await requireDocumentEditRecord(request, params);
  const { companyId, documentType, documentId } = key;
  const formData = await request.formData();

  const toPrint = await editToPrint({
    documentType,
    locked: record.locked,
    isDownload: formData.get("intent") === "download",
    draft: parseDraft(formData),
    readSaved: () => getDocumentEdit(client, key),
    readTemplate: () => getCompanyTemplate(client, key)
  });
  if ("refused" in toPrint) {
    return new Response(toPrint.refused, { status: 400 });
  }

  try {
    return await renderDocumentWithEdit(client, {
      documentType,
      documentId,
      companyId,
      companyGroupId,
      locale: getPreferenceHeaders(request).locale,
      edit: toPrint.edit
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.error("Failed to render the document preview", {
      ...key,
      error
    });
    throw new Response("The preview could not be rendered.", { status: 500 });
  }
}

const notesSchema = z.record(z.string(), z.unknown()).nullable();

function parseDraft(formData: FormData) {
  try {
    const blocks = z
      .array(blockSchema)
      .safeParse(JSON.parse(String(formData.get("blocks") ?? "[]")));
    const settings = documentSettingsSchema.safeParse(
      JSON.parse(String(formData.get("settings") ?? "{}"))
    );
    // Sent only when the user changed them: `undefined` prints the record's.
    const postedNotes = formData.get("notes");
    const notes =
      postedNotes === null
        ? undefined
        : notesSchema.parse(JSON.parse(String(postedNotes)));
    return blocks.success && settings.success
      ? {
          blocks: blocks.data,
          settings: settings.data,
          notes: notes as JSONContent | null | undefined
        }
      : null;
  } catch {
    return null;
  }
}
