// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  DocumentEdit,
  DocumentEditType,
  DocumentTemplate
} from "@carbon/documents/template";
import {
  applyDocumentEdit,
  documentEditSchema,
  resolveTemplate,
  toDocumentTemplate,
  withoutLockedValues
} from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("lib", "document-edit");

/**
 * The saved edits to one document (`documentEdit`), or null when it has none.
 * Every renderer of that document applies them, so the live PDF, the PDF saved
 * at send time and the email attachment print the same words. A failed read
 * throws: printing or emailing the document without its edits would be wrong.
 */
export async function getDocumentEdit(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    documentType: DocumentEditType;
    documentId: string;
  }
): Promise<DocumentEdit | null> {
  const { data, error } = await client
    .from("documentEdit")
    .select("blocks, settings")
    .eq("companyId", args.companyId)
    .eq("documentType", args.documentType)
    .eq("documentId", args.documentId)
    .maybeSingle();
  if (error) {
    logger.error("Failed to read the document's edits", { ...args, error });
    throw new Error("The document's edits could not be read.");
  }
  if (!data) return null;
  const parsed = documentEditSchema.safeParse(data);
  if (!parsed.success) {
    logger.error("The document's stored edits do not parse", {
      ...args,
      error: parsed.error
    });
    throw new Error("The document's stored edits could not be read.");
  }
  return withoutLockedValues(args.documentType, parsed.data);
}

/** The company's template for this type, the default when none is saved. */
export async function getCompanyTemplate(
  client: SupabaseClient<Database>,
  args: { companyId: string; documentType: DocumentEditType }
): Promise<DocumentTemplate> {
  const stored = await client
    .from("documentTemplate")
    .select("*")
    .eq("companyId", args.companyId)
    .eq("documentType", args.documentType)
    .maybeSingle();
  if (stored.error) {
    logger.error("Failed to read the document template", {
      ...args,
      error: stored.error
    });
    throw new Error("The document template could not be read.");
  }
  return resolveTemplate(
    args.documentType,
    toDocumentTemplate(stored.data, args.documentType)
  );
}

/**
 * The template one document prints with: the company's, with this document's
 * edits on top. Pass `edit` to print those instead of the saved ones. Every
 * document renderer reads its template here, so none can forget the edits.
 */
export async function getPrintedTemplate(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    documentType: DocumentEditType;
    documentId: string;
  },
  edit?: DocumentEdit | null
): Promise<DocumentTemplate> {
  const [template, printedEdit] = await Promise.all([
    getCompanyTemplate(client, args),
    edit !== undefined ? edit : getDocumentEdit(client, args)
  ]);
  return applyDocumentEdit(template, printedEdit);
}
