// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { isDocumentEditType } from "@carbon/documents/template";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { documentEditValidator } from "~/modules/settings/settings.models";

/** The "Edit document" modal's data: template, saved edits, lock and notes. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { type, id } = params;
  if (!type || !isDocumentEditType(type) || !id) {
    throw new Response("Document not found", { status: 404 });
  }
  const api = await carbon(request);
  return data(
    await api.settings.getDocumentEditor({ documentType: type, documentId: id })
  );
}

/** Save this document's edits and notes. */
export async function action(args: ActionFunctionArgs) {
  const { type, id } = args.params;
  if (!type || !isDocumentEditType(type) || !id) {
    throw new Response("Document not found", { status: 404 });
  }
  const input = await validator(documentEditValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.saveDocumentEdit({
    documentType: type,
    documentId: id,
    ...input.data
  });
}
