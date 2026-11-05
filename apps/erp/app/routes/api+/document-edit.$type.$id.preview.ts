// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentEdit } from "@carbon/documents/template";
import {
  blockSchema,
  diffDocumentEdit,
  documentSettingsSchema,
  isFigureProblem,
  validateDocumentEdit
} from "@carbon/documents/template";
import {
  getDocumentEdit,
  getPrintedTemplate
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
 * may edit it. The draft is reduced to what differs from the company template,
 * exactly as a save is. A locked record prints its saved edits, whatever is sent,
 * and no draft prints a figure the record does not say.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyGroupId, key, record } =
    await requireDocumentEditRecord(request, params);
  const { companyId, documentType, documentId } = key;
  const formData = await request.formData();
  const isDownload = formData.get("intent") === "download";

  let edit: DocumentEdit | null;
  if (record.locked) {
    edit = await getDocumentEdit(client, key);
  } else {
    const draft = parseDraft(formData);
    if (!draft) return new Response("Invalid document", { status: 400 });

    // `null`: the company template alone, to diff the draft against.
    const template = await getPrintedTemplate(client, key, null);
    edit = diffDocumentEdit(documentType, template, draft);
    const problems = validateDocumentEdit(documentType, template, edit).filter(
      (problem) => isDownload || isFigureProblem(problem)
    );
    if (problems.length > 0) {
      return new Response(problems.map((p) => p.message).join("\n"), {
        status: 400
      });
    }
    edit.notes = draft.notes;
  }

  try {
    const response = await renderDocumentWithEdit(client, {
      documentType,
      documentId,
      companyId,
      companyGroupId,
      locale: getPreferenceHeaders(request).locale,
      edit
    });
    if (!isDownload) return response;
    const headers = new Headers(response.headers);
    headers.set(
      "Content-Disposition",
      (headers.get("Content-Disposition") ?? "").replace("inline", "attachment")
    );
    return new Response(response.body, { status: response.status, headers });
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
